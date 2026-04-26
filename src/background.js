// Description: This file contains the code to intercept media requests and responses and store them in session storage.
// The code is executed in the background script of the extension.

// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}

const mediaTypes = [
    "video/x-flv",
    "video/x-msvideo",
    "video/x-ms-wmv",
    "video/quicktime",
    "video/mp4",
    "audio/x-pcm",
    "audio/wav",
    "audio/mpeg",
    "audio/aac",
    "audio/ogg",
    "audio/x-ms-wma",
    "application/vnd.apple.mpegurl",
    "application/x-mpegURL"
];

let urlList = [];
let headersSentListener, headersReceivedListener;
const activeDownloads = new Map(); // url -> { loaded, total }

// ---------- IndexedDB helpers (same DB used by offlineStreamConvert.js) ----------
const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";
const CHUNK_STORE_NAME = "download-chunks";

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3); // Upgrade version to add store
        request.onerror = (event) => reject(event.target.error || "IDB Open Error");
        request.onblocked = () => {
            console.warn("IndexedDB upgrade blocked by other tabs. Please close them.");
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "url" });
            }
            if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
                db.createObjectStore(CHUNK_STORE_NAME, { keyPath: ["downloadId", "chunkIndex"] });
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

async function storeInCache(url, blob, mime) {
    try {
        const db = await openCacheDB();
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const item = {
            url: url,
            mime: mime || (blob && blob.type) || "application/octet-stream",
            data: blob,
            timestamp: Date.now()
        };
        return await new Promise((resolve, reject) => {
            const req = store.put(item);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("Failed to store in cache:", e);
    }
}

let cachedDB = null;
async function getDB() {
    if (cachedDB) return cachedDB;
    cachedDB = await openCacheDB();
    return cachedDB;
}

async function storeChunkInCache(downloadId, chunkIndex, data) {
    try {
        const db = await getDB();
        const tx = db.transaction([CHUNK_STORE_NAME], "readwrite");
        const store = tx.objectStore(CHUNK_STORE_NAME);
        const item = {
            downloadId: downloadId,
            chunkIndex: chunkIndex,
            data: data,
            timestamp: Date.now()
        };
        return new Promise((resolve, reject) => {
            const req = store.put(item);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("Failed to store chunk in cache:", e);
    }
}
// -------------------------------------------------------------------------------

// ----- extension lists for url-detection -----
const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];

const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions);
// build a safe regex from extensions (escape dots already present)
const extPattern = allExtensions.map(e => e.replace(/^\./, '').replace(/\+/g, '\\+')).join('|');
const detectionRegex = new RegExp('\\.(?:' + extPattern + ')(?:[?#].*)?$', 'i');
const temporaryHeaderMap = new Map();
const temporaryRequestBodyMap = new Map();
const temporaryCookieMap = new Map();
const urlToHeaderMap = new Map(); // Store URL -> { Cookie, Referer }

// helper to interpret setting values
function isFlagEnabled(val) {
    return val === '1' || val === 1 || val === true || val === 'true';
}

// Intercept and store headers for potential downloads, and re-inject them for Native downloads
browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        // 1. Capture headers for every request to use later if it becomes a download
        const cookie = details.requestHeaders.find(h => h.name.toLowerCase() === 'cookie')?.value;
        const referer = details.requestHeaders.find(h => h.name.toLowerCase() === 'referer')?.value;
        if (cookie || referer) {
            urlToHeaderMap.set(details.url, { cookie, referer });
        }

        // 2. If this is a download request triggered by the extension or browser's downloader
        if (details.type === 'other' || details.url.includes('download')) {
            const stored = urlToHeaderMap.get(details.url);
            if (stored) {
                if (stored.cookie) {
                    let hasCookie = false;
                    for (let h of details.requestHeaders) {
                        if (h.name.toLowerCase() === 'cookie') { h.value = stored.cookie; hasCookie = true; break; }
                    }
                    if (!hasCookie) details.requestHeaders.push({ name: 'Cookie', value: stored.cookie });
                }
                if (stored.referer) {
                    let hasReferer = false;
                    for (let h of details.requestHeaders) {
                        if (h.name.toLowerCase() === 'referer') { h.value = stored.referer; hasReferer = true; break; }
                    }
                    if (!hasReferer) details.requestHeaders.push({ name: 'Referer', value: stored.referer });
                }
            }
        }
        
        if (cookie) temporaryCookieMap.set(details.requestId, cookie);

        return { requestHeaders: details.requestHeaders };
    },
    { urls: ["<all_urls>"] },
    ["blocking", "requestHeaders"]
);

// get local settings
function getSettings(callback) {
    browser.storage.local.get(['mime-detection', 'url-detection'], function (result) {
        callback({
            mimeDetection: isFlagEnabled(result['mime-detection']),
            urlDetection: isFlagEnabled(result['url-detection'])
        });
    });
}

// Helper: convert ArrayBuffer to base64 safely in chunks
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB chunks
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

let beforeRequestListener, beforeSendHeadersListener;

function initListener() {
    // Clear indexedDB cache on init to avoid stale data
    openCacheDB().then(db => {
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
    }).catch(e => {
        console.error("Failed to clear IndexedDB cache on init:", e);
    });
    // Decide which urls we will watch for onSendHeaders/onHeadersReceived - keep default <all_urls>
    urlList = ["<all_urls>"];

    // Read settings and then attach listeners accordingly
    getSettings(function (settings) {
        const mimeEnabled = !!settings.mimeDetection;
        const urlEnabled = !!settings.urlDetection;

        console.log('initListener settings: mimeEnabled=', mimeEnabled, 'urlEnabled=', urlEnabled);

        // Remove existing listeners if present
        if (headersSentListener) {
            try { browser.webRequest.onSendHeaders.removeListener(headersSentListener); } catch (e) { }
        }
        if (beforeSendHeadersListener) {
            try { browser.webRequest.onBeforeSendHeaders.removeListener(beforeSendHeadersListener); } catch (e) { }
        }
        if (headersReceivedListener) {
            try { browser.webRequest.onHeadersReceived.removeListener(headersReceivedListener); } catch (e) { }
        }
        if (beforeRequestListener) {
            try { browser.webRequest.onBeforeRequest.removeListener(beforeRequestListener); } catch (e) { }
            beforeRequestListener = null;
        }

        const cleanupListener = (details) => {
            if (temporaryHeaderMap.has(details.requestId)) {
                temporaryHeaderMap.delete(details.requestId);
            }
            if (temporaryRequestBodyMap.has(details.requestId)) {
                temporaryRequestBodyMap.delete(details.requestId);
            }
        };
        // Ensure we don't duplicate cleanup listeners if initListener runs multiple times
        if (!browser.webRequest.onCompleted.hasListener(cleanupListener)) {
            browser.webRequest.onCompleted.addListener(cleanupListener, { urls: ["<all_urls>"] });
            browser.webRequest.onErrorOccurred.addListener(cleanupListener, { urls: ["<all_urls>"] });
        }

        // NEW: capture request bodies in onBeforeRequest (formData or raw bytes).
        beforeRequestListener = function (details) {
            try {
                if (!details || !details.requestBody) return;

                const rb = details.requestBody;

                if (rb.formData) {
                    // formData is an object of arrays; safe to store directly
                    temporaryRequestBodyMap.set(details.requestId, { type: 'formData', data: rb.formData });
                } else if (rb.raw && rb.raw.length) {
                    // raw may contain an ArrayBuffer/Uint8Array in .bytes
                    try {
                        // Combine all raw parts into one ArrayBuffer (if multiple)
                        let totalLen = 0;
                        for (let part of rb.raw) {
                            if (part && part.bytes) {
                                totalLen += part.bytes.byteLength || part.bytes.length || 0;
                            }
                        }
                        if (totalLen === 0) {
                            // nothing to store
                            return;
                        }
                        // create combined buffer
                        const combined = new Uint8Array(totalLen);
                        let offset = 0;
                        for (let part of rb.raw) {
                            if (!part || !part.bytes) continue;
                            const src = new Uint8Array(part.bytes);
                            combined.set(src, offset);
                            offset += src.length;
                        }
                        const base64 = arrayBufferToBase64(combined.buffer);
                        temporaryRequestBodyMap.set(details.requestId, { type: 'base64', data: base64 });
                    } catch (e) {
                        console.warn("Failed to serialize raw request body for requestId", details.requestId, e);
                    }
                }
            } catch (e) {
                console.error("Error in onBeforeRequest listener (requestBody capture):", e);
            }
        };

        // Attach beforeRequest listener to capture requestBody. Guard for availability.
        try {
            if (browser.webRequest && browser.webRequest.onBeforeRequest && !browser.webRequest.onBeforeRequest.hasListener(beforeRequestListener)) {
                browser.webRequest.onBeforeRequest.addListener(
                    beforeRequestListener,
                    { urls: urlList },
                    ['requestBody']
                );
            }
        } catch (e) {
            console.warn("Failed to attach onBeforeRequest requestBody listener:", e);
        }

        beforeSendHeadersListener = async function (details) {
            const protocol = new URL(details.originUrl).protocol
            if(protocol === 'moz-extension:' || protocol === 'chrome-extension:') {
                // Requests is from extension itself, so try to add cookies
                try {
                    const cookie = temporaryCookieMap.get(details.requestId) || '';
                    if (cookie) {
                        details.requestHeaders.push({ name: 'Cookie', value: cookie });
                        console.debug("Added Cookie header to extension request:", cookie);
                    }
                } catch (e) {
                    console.error("Error adding Cookie header to extension request:", e);
                }
            }
            else {
                // For non-extension requests, we rely on onHeadersReceived to get cookies from response
                console.debug("Details:", details);

                const cookie = details.requestHeaders.find(h => h.name.toLowerCase() === 'cookie')?.value || '';
                if (cookie) {
                    console.debug("Request already has Cookie header:", cookie);
                }
                
                //Store the cookies from request headers into the corresponding request object in existingRequests
                temporaryCookieMap.set(details.requestId, cookie);

            }
            return { requestHeaders: details.requestHeaders };
        };

        browser.webRequest.onBeforeSendHeaders.addListener(
            beforeSendHeadersListener,
            { urls: urlList },
            ['requestHeaders', 'blocking']
        );
        console.log("Attached onBeforeSendHeaders listener.");

        headersSentListener = async function (details) {
            try {
                // [NEW] Always capture headers to the temporary map first
                if (details.requestHeaders) {
                    temporaryHeaderMap.set(details.requestId, details.requestHeaders);
                }

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                // If neither flag is enabled -> save all (original behavior)
                if (!mimeEnabled && !urlEnabled) {
                    // Save as before
                } else {
                    // If url-detection enabled and URL matches -> save
                    if (!urlEnabled || (urlEnabled && !urlMatches)) {
                        // If url-detection enabled but URL doesn't match, and mime-detection is enabled,
                        // then we should NOT save now (wait for onHeadersReceived). So skip saving here.
                        if (urlEnabled && mimeEnabled && !urlMatches) {
                            // wait for onHeadersReceived to decide
                            return;
                        }
                        if (mimeEnabled && !urlEnabled) {
                            return;
                        }
                        // If urlEnabled is true and urlMatches is true -> fallthrough to save
                        // Otherwise, if logic reaches here but conditions didn't match, skip
                    }
                }

                // At this point either:
                // - neither flag set (=> save all), or
                // - urlEnabled && urlMatches (=> save), or
                // - both enabled and urlMatches (=> save)
                // [NEW] Retrieve any cached request body
                const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;
                

                let mediaRequest = {
                    url: details.url,
                    method: details.method,
                    requestHeaders: details.requestHeaders,
                    responseHeaders: null,
                    requestBody: cachedBody,
                    cookie: temporaryCookieMap.get(details.requestId) || '',
                    size: null,
                    timeStamp: null
                };

                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = result[details.url] || [];

                    // push the new request
                    existingRequests.push(mediaRequest);
                    let requestsObj = {};
                    requestsObj[details.url] = existingRequests;
                    browser.storage.session.set(requestsObj);
                    console.log('Media request intercepted (onSendHeaders):', mediaRequest);
                });
            } catch (e) {
                console.error("Error in onSendHeaders handler:", e);
            }
        };

        browser.webRequest.onSendHeaders.addListener(
            headersSentListener,
            { urls: urlList },
            ['requestHeaders']
        );

        // onHeadersReceived: used to update size/responseHeaders and also to save requests when mime-detection triggers
        headersReceivedListener = async function (details) {
            try {
                // Extract content-length and content-type (if present)
                const responseHeaders = details.responseHeaders || [];
                let size = 'unknown';
                
                let mediaSizeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-length');
                if (mediaSizeHeader) size = mediaSizeHeader.value;

                // Better size detection: check Content-Range for total size (e.g., bytes 0-1023/1000000)
                let contentRangeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-range');
                if (contentRangeHeader && contentRangeHeader.value.includes('/')) {
                    const totalSize = contentRangeHeader.value.split('/').pop();
                    if (totalSize && totalSize !== '*') {
                        size = totalSize;
                    }
                }

                let contentTypeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-type');
                let contentType = contentTypeHeader ? (contentTypeHeader.value || '').toLowerCase() : '';

                // Normalize contentType (strip parameters)
                if (contentType.indexOf(';') !== -1) {
                    contentType = contentType.split(';')[0].trim().toLowerCase();
                }

                const mimeMatches = (
                    contentType.startsWith('audio/') ||
                    contentType.startsWith('video/') ||
                    contentType === 'application/vnd.apple.mpegurl' ||
                    contentType === 'application/x-mpegurl' ||
                    contentType === 'application/dash+xml' ||
                    contentType === 'application/octet-stream' // <-- treat generic binary as potential media (or segments)
                );

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                // Retrieve existing stored requests for this URL (if any)
                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = result[details.url] || [];

                    // Try to find a previously created request to update it
                    let updated = false;
                    for (let request of existingRequests) {
                        // If the request has no size / responseHeaders yet, update it
                        if (!request.size && (!request.responseHeaders || request.responseHeaders === null)) {
                            request.size = size;
                            request.responseHeaders = responseHeaders;
                            request.timeStamp = details.timeStamp;
                            updated = true;
                            break;
                        }
                    }

                    // Decide whether to add a new request entry in cases where onSendHeaders did not add one:
                    // - If neither flag set -> onSendHeaders already added, so we should have updated above.
                    // - If mime-detection only and mimeMatches -> add new entry here
                    // - If both enabled and neither matched onSendHeaders but mimeMatches now -> add
                    // - If url-detection only, we would have saved at onSendHeaders; no need to add here.
                    // So add if:
                    // (mimeEnabled && mimeMatches) OR (urlEnabled && urlMatches AND no existing request present)
                    // but guard against duplicates: only push if `updated` is false AND the saving condition matches.

                    getSettings(async function (currentSettings) {
                        const mimeEnabledNow = !!currentSettings.mimeDetection;
                        const urlEnabledNow = !!currentSettings.urlDetection;

                        const shouldSaveNow = (() => {
                            if (!mimeEnabledNow && !urlEnabledNow) return true;
                            if (mimeEnabledNow && mimeMatches) return true;
                            if (urlEnabledNow && urlMatches) return true;
                            return false;
                        })();

                        if (!updated && shouldSaveNow) {
                            // [NEW] Retrieve the stashed request headers and request body using requestId
                            const cachedHeaders = temporaryHeaderMap.get(details.requestId) || null;
                            const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;

                            let mediaRequest = {
                                url: details.url,
                                method: details.method || 'GET',
                                requestHeaders: cachedHeaders,
                                responseHeaders: responseHeaders,
                                requestBody: cachedBody, // <-- now populated if available
                                cookie: temporaryCookieMap.get(details.requestId) || '',
                                size: size,
                                timeStamp: details.timeStamp
                            };
                            existingRequests.push(mediaRequest);
                            console.log('Media request added (onHeadersReceived):', mediaRequest);
                        } else if (updated) {
                            console.log('Media response updated (onHeadersReceived) for', details.url);
                        }

                        let requestsObj = {};
                        requestsObj[details.url] = existingRequests;
                        browser.storage.session.set(requestsObj);
                    });
                });
            } catch (e) {
                console.error("Error in onHeadersReceived handler:", e);
            }
        };

        browser.webRequest.onHeadersReceived.addListener(
            headersReceivedListener,
            { urls: urlList },
            ['responseHeaders']
        );
    });
}

// Track native downloads
browser.downloads.onCreated.addListener((downloadItem) => {
    if (downloadItem.url && (downloadItem.url.startsWith('http') || downloadItem.url.startsWith('blob'))) {
        activeDownloads.set(downloadItem.id, { 
            url: downloadItem.url, 
            loaded: 0, 
            total: downloadItem.totalBytes,
            isNative: true 
        });
    }
});

browser.downloads.onChanged.addListener((delta) => {
    const item = activeDownloads.get(delta.id);
    if (!item) return;

    if (delta.bytesReceived) item.loaded = delta.bytesReceived.current;
    if (delta.totalBytes) item.total = delta.totalBytes.current;

    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        let errorMsg = delta.error ? delta.error.current : null;
        if (delta.state.current === 'interrupted' && (errorMsg === 'USER_CANCELED' || errorMsg === 'USER_SHUTDOWN')) {
            errorMsg = 'USER_CANCELED';
        }

        browser.runtime.sendMessage({
            action: delta.state.current === 'complete' ? 'downloadComplete' : 'downloadError',
            id: delta.id,
            url: item.url,
            error: errorMsg
        }).catch(() => {});
        activeDownloads.delete(delta.id);
    } else {
        browser.runtime.sendMessage({
            action: 'downloadProgress',
            id: delta.id,
            url: item.url,
            loaded: item.loaded,
            total: item.total
        }).catch(() => {});
    }
});

// Send media request data to the popup (session storage is not shared between background and popup scripts)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getMediaRequests') {
        browser.storage.session.get(null, function (items) {
            sendResponse(items);
        });
        return true; // Indicate that the response will be sent asynchronously
    }

    if (message.action === 'startFetchDownload') {
        handleFetchDownload(message.url, message.filename, message.request, message.downloadId);
        return true;
    }

    if (message.action === 'cancelDownload') {
        let targetId = null;
        let isNative = false;
        for (let [id, val] of activeDownloads) {
            if (val.url === message.url) {
                targetId = id;
                isNative = !!val.isNative;
                break;
            }
        }
        
        if (targetId) {
            const item = activeDownloads.get(targetId);
            if (isNative) {
                browser.downloads.cancel(targetId);
                activeDownloads.delete(targetId);
                // browser.downloads.onChanged will handle sending downloadError/USER_CANCELED
            } else if (item && item.abortController) {
                item.abortController.abort();
                activeDownloads.delete(targetId);
            }
        }
        return true;
    }

    if (message.action === 'getActiveDownloads') {
        const downloadsObj = {};
        for (let [id, value] of activeDownloads) {
            downloadsObj[id] = {
                id: id,
                loaded: value.loaded,
                total: value.total,
                url: value.url
            };
        }
        sendResponse(downloadsObj);
        return true;
    }
});

function getFileName(url, maxLength = 30) {
    try {
        let parsedUrl = new URL(url);
        let fileName = parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1).split('?')[0];
        fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        if (!fileName) fileName = parsedUrl.hostname;
        if (fileName.length > maxLength) fileName = fileName.substring(0, maxLength) + '…';
        return decodeURIComponent(fileName);
    } catch (e) { return "Media File"; }
}

const pendingSaveQueue = [];
let activeBridgeTabId = null;

async function processSaveQueue() {
    if (activeBridgeTabId !== null || pendingSaveQueue.length === 0) return;

    const nextDownload = pendingSaveQueue.shift();
    const { id, url, filename } = nextDownload;

    const tab = await browser.tabs.create({
        url: browser.runtime.getURL(`download.html?id=${id}&url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`),
        active: true
    });
    activeBridgeTabId = tab.id;
}

// Listen for the bridge tab closing to open the next one in queue
browser.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeBridgeTabId) {
        activeBridgeTabId = null;
        // Small delay before opening the next one for better UX on Android
        setTimeout(processSaveQueue, 1000);
    }
});

async function handleFetchDownload(url, filename, originalRequest = null, providedId = null) {
    const abortController = new AbortController();
    const downloadId = providedId || ('dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    try {
        const fetchOptions = {
            method: originalRequest ? originalRequest.method : 'GET',
            headers: {},
            credentials: 'include', // Important for cookies
            signal: abortController.signal
        };

        if (originalRequest && originalRequest.requestHeaders) {
            originalRequest.requestHeaders.forEach(h => {
                const name = h.name.toLowerCase();
                if (name !== 'cookie' && name !== 'referer') {
                    fetchOptions.headers[h.name] = h.value;
                }
            });
        }

        // Add cookies and referer if available
        const storedHeaders = urlToHeaderMap.get(url);
        if (storedHeaders) {
            if (storedHeaders.referer) {
                fetchOptions.referrer = storedHeaders.referer;
            }
        }
        
        // Manual override from requestHeaders if present
        const manualReferer = originalRequest?.requestHeaders?.find(h => h.name.toLowerCase() === 'referer')?.value;
        if (manualReferer) fetchOptions.referrer = manualReferer;

        if (originalRequest && originalRequest.method !== 'GET' && originalRequest.requestBody) {
            if (originalRequest.requestBody.type === 'formData') {
                const formData = new FormData();
                for (const key in originalRequest.requestBody.data) {
                    originalRequest.requestBody.data[key].forEach(val => formData.append(key, val));
                }
                fetchOptions.body = formData;
            } else if (originalRequest.requestBody.type === 'base64') {
                const bin = atob(originalRequest.requestBody.data);
                const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                fetchOptions.body = u;
            }
        }

        const response = await fetch(url, fetchOptions);
        if (!response.ok) throw new Error("Server error: " + response.status);

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        
        activeDownloads.set(downloadId, { loaded: 0, total: total, abortController: abortController, url: url });

        const reader = response.body.getReader();
        let loaded = 0;
        let lastReportTime = 0;
        let chunkIndex = 0;
        
        const writeQueue = [];
        const MAX_WRITE_QUEUE = 3; 

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const currentChunk = value;
            const currentChunkIndex = chunkIndex++;

            loaded += currentChunk.length;
            activeDownloads.set(downloadId, { loaded, total, abortController, url: url });

            // Update UI immediately (every 50ms)
            const now = Date.now();
            if (now - lastReportTime > 50) {
                lastReportTime = now;
                browser.runtime.sendMessage({
                    action: 'downloadProgress',
                    id: downloadId,
                    url: url,
                    loaded: loaded,
                    total: total
                }).catch(() => {});
            }

            // Write to IndexedDB without blocking the next network read immediately
            const writePromise = storeChunkInCache(downloadId, currentChunkIndex, currentChunk);
            writeQueue.push(writePromise);
            
            // Allow the network to stay a few chunks ahead of the disk
            if (writeQueue.length >= MAX_WRITE_QUEUE) {
                await writeQueue.shift();
            }
        }
        
        // Ensure all pending writes finish
        await Promise.all(writeQueue);
        
        browser.runtime.sendMessage({
            action: 'downloadProgress',
            id: downloadId,
            url: url,
            loaded: loaded,
            total: total
        }).catch(() => {});

        const finalFilename = filename || getFileName(url);

        // Store metadata in cache to signal chunked download
        await storeInCache(downloadId, null, response.headers.get('content-type'));
        
        // Add to queue instead of opening immediately
        pendingSaveQueue.push({ id: downloadId, url, filename: finalFilename });
        processSaveQueue();

        activeDownloads.delete(downloadId);
        browser.runtime.sendMessage({ action: 'downloadComplete', id: downloadId, url: url }).catch(() => {});

    } catch (error) {
        // Find the downloadId if possible to cleanup
        let targetId = null;
        for (let [id, val] of activeDownloads) {
            if (val.url === url) {
                targetId = id;
                break;
            }
        }
        if (targetId) activeDownloads.delete(targetId);
        
        console.error("Background fetch download failed:", error);
        const errorMsg = (error.name === 'AbortError') ? 'USER_CANCELED' : error.message;
        browser.runtime.sendMessage({ action: 'downloadError', url: url, error: errorMsg }).catch(() => {});
    }
}

// Help Native downloads by injecting headers from the original request
browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        // If this is a download request triggered by the extension
        if (details.type === 'other' || details.url.includes('download')) {
            // We could try to match URL and inject cookies here if needed
        }
        return { requestHeaders: details.requestHeaders };
    },
    { urls: ["<all_urls>"] },
    ["blocking", "requestHeaders"]
);

// Set default settings on install
browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        const defaults = {
            'download-method': 'browser', // Default to Native for direct experience
            'mime-detection': '1',
            'url-detection': '1',
            'media-cache': '1'
        };
        await browser.storage.local.set(defaults);
        
        browser.tabs.create({
            url: browser.runtime.getURL('installed.md'),
        });
    }
});


// Initialize the listener
initListener();

// Initialize popup state
browser.storage.local.get('open-preference', function (result) {
    if (result['open-preference'] === 'popup') {
        browser.action.setPopup({ popup: 'popup.html' });
    } else {
        browser.action.setPopup({ popup: '' });
    }
});

// Clear local storage when message is received
browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'clearStorage') {
        // Get all active download URLs
        const activeUrls = new Set();
        for (const [key, value] of activeDownloads) {
            if (value.url) activeUrls.add(value.url);
        }

        browser.storage.session.get(null, function (items) {
            const keysToRemove = [];
            for (const url in items) {
                if (!activeUrls.has(url)) {
                    keysToRemove.push(url);
                }
            }
            if (keysToRemove.length > 0) {
                browser.storage.session.remove(keysToRemove);
            }
        });

        // Also clear IndexedDB cache, but maybe we should also keep active ones? 
        // For now, let's just clear it as before, or skip if we want to be safe.
        // Usually, IndexedDB is only for completed fetch downloads or stream segments.
        openCacheDB().then(db => {
            const tx = db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            store.clear();
        }).catch(e => {
            console.error("Failed to clear IndexedDB cache:", e);
        });
    }
});

// This is used to open the popup.html file when the add-on icon is clicked, and to open the installed.md and when the add-on is installed.
browser.action.onClicked.addListener((tab) => {
    browser.storage.local.get('open-preference', function (result) {
        console.log('Open preference:', result['open-preference']);
        if (result['open-preference'] !== 'window') {
            // Open the popup in a new tab
            browser.tabs.create({
                url: browser.runtime.getURL(`popup.html`),
            });
        } else {
            // Open the popup in a new window
            browser.windows.create({
                url: browser.runtime.getURL(`popup.html`),
                type: 'popup',
                width: 800,
                height: 600,
            });
        }
    });
});

browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        browser.tabs.create({
            url: browser.runtime.getURL('installed.md'),
        });
    }
});

browser.runtime.onStartup.addListener(initListener);

browser.runtime.setUninstallURL(`https://github.com/anpa26/website-media-downloader`);

// ----------------- Capture & cache media response bodies -----------------
// We use onHeadersReceived to detect Content-Type, and if it's a media type we attach
// a filterResponseData stream to capture the response body and store it into IndexedDB.
// ------------------------------------------------------------------------------

let cacheListener = null;
let mediaCacheEnabled = false;

// helper to safely remove current listener
function detachCacheListener() {
    if (!cacheListener) return;
    try {
        browser.webRequest.onBeforeRequest.removeListener(cacheListener);
    } catch (e) { /* ignore if already removed */ }
    cacheListener = null;
    console.debug("Cache listener detached.");
}

// attach listener (only when we already know mediaCacheEnabled === true)
function attachCacheListener() {
    if (cacheListener) return; // already attached

    // guard: if runtime doesn't support filterResponseData, don't attach
    if (!browser.webRequest || !browser.webRequest.filterResponseData) {
        console.warn("filterResponseData not available; not attaching cache listener.");
        return;
    }

    cacheListener = (details) => {
        try {
            // quick checks; avoid any async storage calls here
            if (details.incognito) return;
            
            // CRITICAL: Only intercept if it looks like media. 
            // Intercepting everything (CSS, JS) breaks the browser.
            if (!detectionRegex.test(details.url)) return;

            // attach filter to stream & capture the response body
            let filter;
            try {
                filter = browser.webRequest.filterResponseData(details.requestId);
            } catch (e) {
                console.warn("filterResponseData failed for requestId", details.requestId, e);
                return;
            }

            let chunkIndex = 0;
            const downloadId = details.url; // For auto-cache, we use URL as ID

            filter.ondata = (event) => {
                try {
                    // Write back to browser IMMEDIATELY to avoid blocking rendering
                    filter.write(event.data);
                    
                    // Store chunk in IndexedDB (non-blocking)
                    storeChunkInCache(downloadId, chunkIndex++, event.data);
                } catch (e) {
                    console.error("Error writing chunk back to filter:", e);
                }
            };
            filter.onstop = async () => {
                try {
                    filter.disconnect();
                    // Store metadata in cache to signal chunked download
                    // We don't have the full blob here anymore, and that's the point.
                    await storeInCache(downloadId, null, 'application/octet-stream');
                    console.log("Cached response chunks for:", details.url);
                } catch (e) {
                    console.error("Failed to cache response body for", details.url, e);
                }
            };
            filter.onerror = (err) => {
                try { filter.disconnect(); } catch (e) {}
                console.error("filter error:", err);
            };
        } catch (e) {
            console.error("Error in cache listener:", e);
        }
    };

    browser.webRequest.onBeforeRequest.addListener(
        cacheListener,
        { urls: ["<all_urls>"], /*types: ["media", "object"]*/ }, // Types can't work with MPD files as the MPD request is categorized as "xmlhttprequest"
        ["blocking"]
    );

    console.debug("Cache listener attached.");
}

// read initial setting from storage and attach/detach accordingly
async function initCacheState() {
    try {
        const res = await browser.storage.local.get('media-cache');
        const enabled = !!isFlagEnabled(res['media-cache']);
        mediaCacheEnabled = enabled;
        if (mediaCacheEnabled) {
            attachCacheListener();
        } else {
            detachCacheListener();
        }
    } catch (e) {
        console.error("Failed to read media-cache setting:", e);
        // default to detached to avoid blocking requests
        mediaCacheEnabled = false;
        detachCacheListener();
    }
}

// watch for runtime changes to storage and update attachment immediately
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!Object.prototype.hasOwnProperty.call(changes, 'media-cache')) return;

    const newEnabled = !!isFlagEnabled(changes['media-cache'].newValue);
    if (newEnabled === mediaCacheEnabled) return; // no change

    mediaCacheEnabled = newEnabled;
    if (mediaCacheEnabled) {
        attachCacheListener();
    } else {
        detachCacheListener();
    }
});

// optional: message API to force re-init from elsewhere
browser.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'initCacheListener') {
        initCacheState();
    }
});

// do initial setup
initCacheState();
