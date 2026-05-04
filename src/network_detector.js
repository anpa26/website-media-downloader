/*
    website-media-downloader - A versatile tool to detect and download videos, music, and streams from almost any website.
    Copyright (C) 2026 anpa26

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// Description: This file contains the code to intercept media requests and responses and store them in session storage.
// The code is executed in the background script of the extension.

// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}

// Import client-zip if not already loaded (needed for Chrome Service Worker)
if (typeof downloadZip === 'undefined') {
    try {
        importScripts('libraries/client-zip.js');
    } catch (e) {
        console.error("Failed to import client-zip.js:", e);
    }
}

// Session storage polyfill/fallback for browsers that don't support it (e.g. some Android browsers)
if (!browser.storage.session) {
    browser.storage.session = {
        get: (keys, cb) => browser.storage.local.get(keys, cb),
        set: (obj, cb) => browser.storage.local.set(obj, cb),
        remove: (keys, cb) => browser.storage.local.remove(keys, cb),
        clear: (cb) => browser.storage.local.clear(cb)
    };
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
    "application/x-mpegURL",
    "text/vtt",
    "application/x-subrip",
    "text/srt",
    "application/x-ass",
    "text/x-ass",
    "application/ttml+xml",
    "application/x-dfxp+xml"
];

let urlList = [];
let headersSentListener, headersReceivedListener;
const activeDownloads = new Map(); // url -> { loaded, total }

// ---------- Persistent Download State Helpers ----------
async function saveDownloadState(downloadId, data) {
    const res = await browser.storage.local.get('pending-downloads');
    const pending = res['pending-downloads'] || {};
    pending[downloadId] = {
        url: data.url,
        filename: data.filename,
        total: data.total,
        loaded: data.loaded,
        originalRequest: data.originalRequest,
        chunkIndex: data.chunkIndex || 0,
        timestamp: Date.now(),
        isParallel: !!data.isParallel
    };
    await browser.storage.local.set({ 'pending-downloads': pending });
}

async function removeDownloadState(downloadId) {
    const res = await browser.storage.local.get('pending-downloads');
    const pending = res['pending-downloads'] || {};
    delete pending[downloadId];
    await browser.storage.local.set({ 'pending-downloads': pending });
}

async function removeMediaRequest(url) {
    if (!url) return;
    try {
        const baseUrl = url.split('?')[0];
        const res = await browser.storage.session.get(null);
        
        // Get all currently active download URLs
        const activeUrls = new Set();
        for (const val of activeDownloads.values()) {
            if (val.url) activeUrls.add(val.url);
        }

        const keysToRemove = [];
        for (const key in res) {
            // Match same base URL (identity) and ensure it's not active
            if (key.split('?')[0] === baseUrl && !activeUrls.has(key)) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            await browser.storage.session.remove(keysToRemove);
        }
    } catch (e) {
        console.error("Error in removeMediaRequest:", e);
        // Fallback to exact match if something goes wrong
        browser.storage.session.remove(url).catch(() => {});
    }
}

async function resumeInterruptedDownloads() {
    const res = await browser.storage.local.get('pending-downloads');
    const pending = res['pending-downloads'] || {};
    const ids = Object.keys(pending);
    
    if (ids.length > 0) {
        console.log(`Found ${ids.length} interrupted downloads. Resuming...`);
        for (const id of ids) {
            const data = pending[id];
            // Small delay between resumes to avoid overwhelming
            setTimeout(() => {
                handleFetchDownload(data.url, data.filename, data.originalRequest, id, true);
            }, 1000);
        }
    }
}

// Run resume on startup
resumeInterruptedDownloads();

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
        const db = await getDB();
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

async function storeChunksInCache(downloadId, chunks) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([CHUNK_STORE_NAME], "readwrite");
            const store = tx.objectStore(CHUNK_STORE_NAME);
            
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(new Error("Transaction aborted"));

            for (const chunk of chunks) {
                const item = {
                    downloadId: downloadId,
                    chunkIndex: chunk.index,
                    data: chunk.data,
                    timestamp: Date.now()
                };
                store.put(item);
            }
        });
    } catch (e) {
        console.error("Failed to store chunks in cache:", e);
    }
}

async function storeChunkInCache(downloadId, chunkIndex, data) {
    return storeChunksInCache(downloadId, [{ index: chunkIndex, data: data }]);
}
// -------------------------------------------------------------------------------

// ----- extension lists for url-detection -----
const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp"];
const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif"];
const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions, subtitleExtensions, imageExtensions);

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

// Intercept and store headers for potential downloads, and re-inject them for Native downloads and previews
browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        // 1. Capture headers for every request to use later if it becomes a download or preview
        const cookie = details.requestHeaders.find(h => h.name.toLowerCase() === 'cookie')?.value;
        const referer = details.requestHeaders.find(h => h.name.toLowerCase() === 'referer')?.value;
        const origin = details.requestHeaders.find(h => h.name.toLowerCase() === 'origin')?.value;
        
        if (cookie || referer || origin) {
            urlToHeaderMap.set(details.url, { cookie, referer, origin });
        }

        // 2. Spoof headers if this is a download OR a request from the extension (for previews/fetch)
        const isFromExtension = details.initiator?.startsWith('chrome-extension://') || 
                               details.originUrl?.startsWith('moz-extension://') ||
                               details.url.includes('blob:chrome-extension://');
        
        const isMediaRequest = details.type === 'media' || 
                               details.type === 'xmlhttprequest' || 
                               details.type === 'other' ||
                               details.url.includes('download') ||
                               detectionRegex.test(details.url);

        if (isMediaRequest || isFromExtension) {
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
                    
                    // Also try to set referrer for extension requests
                    if (isFromExtension) {
                        // Some browsers don't allow setting Referer header directly but might use this
                        details.referrer = stored.referer;
                    }
                }
                if (stored.origin) {
                    let hasOrigin = false;
                    for (let h of details.requestHeaders) {
                        if (h.name.toLowerCase() === 'origin') { h.value = stored.origin; hasOrigin = true; break; }
                    }
                    if (!hasOrigin) details.requestHeaders.push({ name: 'Origin', value: stored.origin });
                }
                
                // Also fix Sec-Fetch headers for extension/media requests to avoid blocks
                if (isFromExtension || isMediaRequest) {
                    details.requestHeaders = details.requestHeaders.filter(h => 
                        !['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(h.name.toLowerCase())
                    );
                    details.requestHeaders.push({ name: 'Sec-Fetch-Site', value: 'same-origin' });
                    details.requestHeaders.push({ name: 'Sec-Fetch-Mode', value: 'no-cors' });
                    details.requestHeaders.push({ name: 'Sec-Fetch-Dest', value: 'video' });
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
    browser.storage.local.get([
        'mime-detection', 'url-detection', 'media-notification', 'hide-segments', 
        'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle',
        'filename-template'
    ], function (result) {
        callback({
            mimeDetection: isFlagEnabled(result['mime-detection']),
            urlDetection: isFlagEnabled(result['url-detection']),
            mediaNotification: isFlagEnabled(result['media-notification']),
            hideSegments: isFlagEnabled(result['hide-segments']),
            onlyVideo: isFlagEnabled(result['only-video']),
            onlyAudio: isFlagEnabled(result['only-audio']),
            onlyStream: isFlagEnabled(result['only-stream']),
            onlyImage: isFlagEnabled(result['only-image']),
            onlySubtitle: isFlagEnabled(result['only-subtitle']),
            filenameTemplate: result['filename-template'] || ''
        });
    });
}

const notificationUrls = new Map(); // notificationId -> { url, tabId }
const notifiedUrls = new Map(); // tabId -> Set of URLs
const lastNotificationTime = new Map(); // tabId -> timestamp

function injectNotificationScript(tabId, filename, url) {
    if (!browser.scripting) return;
    
    browser.scripting.executeScript({
        target: { tabId: tabId },
        func: (name, downloadUrl, dlLabel) => {
            // Find existing toasts and shift them up
            const existingToasts = document.querySelectorAll('.mdu-toast');
            existingToasts.forEach(t => {
                const currentBottom = parseInt(t.style.bottom);
                t.style.bottom = (currentBottom + 80) + 'px';
            });

            const toast = document.createElement('div');
            toast.className = 'mdu-toast';
            toast.style.cssText = `
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
                background: #323232; color: white; padding: 12px 16px; border-radius: 8px;
                z-index: 2147483647; display: flex; align-items: center; gap: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4); font-family: system-ui, -apple-system, sans-serif;
                font-size: 14px; min-width: 280px; max-width: 90vw; justify-content: space-between;
                transition: bottom 0.3s ease;
                animation: mdu-fade-in 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            `;

            const text = document.createElement('span');
            text.textContent = name;
            text.style.cssText = `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;`;

            const actions = document.createElement('div');
            actions.style.cssText = `display: flex; align-items: center; gap: 8px; flex-shrink: 0;`;

            const dlBtn = document.createElement('button');
            dlBtn.textContent = dlLabel;
            dlBtn.style.cssText = `
                background: #bbdefb; color: #000; border: none; padding: 6px 12px;
                border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 12px;
            `;
            dlBtn.onclick = () => {
                chrome.runtime.sendMessage({ action: 'startDownloadFromToast', url: downloadUrl });
                toast.remove();
            };

            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = `
                background: transparent; color: rgba(255,255,255,0.7); border: none;
                cursor: pointer; font-size: 16px; padding: 4px;
            `;
            closeBtn.onclick = () => toast.remove();

            actions.appendChild(dlBtn);
            actions.appendChild(closeBtn);
            toast.appendChild(text);
            toast.appendChild(actions);

            const style = document.createElement('style');
            style.id = 'mdu-toast-style';
            style.textContent = `
                @keyframes mdu-fade-in { from { bottom: 0; opacity: 0; } to { bottom: 24px; opacity: 1; } }
            `;
            if (!document.getElementById('mdu-toast-style')) document.head.appendChild(style);
            document.body.appendChild(toast);

            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 6000);
        },
        args: [filename, url, browser.i18n.getMessage("mediaNotificationDownloadAction") || "Download"]
    }).catch(() => {});
}

function getMediaType(url, contentType) {
    if (!url) return null;
    const urlLower = url.toLowerCase();
    const mimeLower = (contentType || '').toLowerCase();

    // Ignore extension internal assets and blob URLs from the extension itself
    if (urlLower.startsWith('chrome-extension://') || 
        urlLower.startsWith('moz-extension://') || 
        urlLower.startsWith('blob:chrome-extension://') || 
        urlLower.startsWith('blob:moz-extension://')) {
        return null;
    }
    
    if (mimeLower.startsWith('video/') || videoExtensions.some(ext => urlLower.includes(ext))) return 'video';
    if (mimeLower.startsWith('audio/') || audioExtensions.some(ext => urlLower.includes(ext))) return 'audio';
    
    // Explicitly exclude SVG to avoid cluttering with icons/logos
    if (mimeLower === 'image/svg+xml' || urlLower.includes('.svg')) return null;
    if (mimeLower.startsWith('image/') || imageExtensions.some(ext => urlLower.includes(ext))) return 'image';
    
    if (streamExtensions.some(ext => urlLower.includes(ext)) || mimeLower.includes('mpegurl') || mimeLower.includes('dash+xml')) return 'stream';
    if (subtitleExtensions.some(ext => urlLower.includes(ext)) || mimeLower.includes('vtt') || mimeLower.includes('subrip') || mimeLower.includes('ass') || mimeLower.includes('ttml') || mimeLower.includes('dfxp')) return 'subtitle';
    
    return null;
}

async function addToHistory(item) {
    const result = await browser.storage.local.get('history-page');
    if (result['history-page'] !== '1') return;

    // Ensure item has a media type for filtering
    if (!item.mediaType) {
        item.mediaType = getMediaType(item.url, '');
    }

    const historyResult = await browser.storage.local.get('download-history');
    let history = historyResult['download-history'] || [];
    
    item.timestamp = item.timestamp || Date.now();
    
    // Remove if exactly same URL or (same pageUrl AND same filename)
    // This handles deduplication: old entry is replaced by the newest one
    const existingIndex = history.findIndex(h => 
        h.url === item.url || 
        (h.pageUrl === item.pageUrl && h.filename === item.filename)
    );
    
    if (existingIndex !== -1) {
        history.splice(existingIndex, 1);
    }
    
    history.unshift(item);
    if (history.length > 100) history = history.slice(0, 100);
    await browser.storage.local.set({ 'download-history': history });
}

function showSimpleToast(tabId, message) {
    if (!browser.scripting) return;
    browser.scripting.executeScript({
        target: { tabId: tabId },
        func: (msg) => {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
                background: #4caf50; color: white; padding: 12px 24px; border-radius: 8px;
                z-index: 2147483647; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-family: system-ui, sans-serif; font-size: 14px; font-weight: 500;
                animation: mdu-slide-down 0.4s cubic-bezier(0, 0, 0.2, 1);
            `;
            toast.textContent = msg;

            const style = document.createElement('style');
            style.textContent = `@keyframes mdu-slide-down { from { top: -60px; opacity: 0; } to { top: 24px; opacity: 1; } }`;
            document.head.appendChild(style);
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; setTimeout(() => toast.remove(), 500); }, 3000);
        },
        args: [message]
    }).catch(() => {});
}

async function autoUpdateHistoryLink(pageUrl, filename, newUrl, tabId) {
    const historyResult = await browser.storage.local.get('download-history');
    let history = historyResult['download-history'] || [];
    let updated = false;

    for (let i = 0; i < history.length; i++) {
        // Match by pageUrl and filename to find the right record to update
        if (history[i].pageUrl === pageUrl && history[i].filename === filename) {
            if (history[i].url !== newUrl) {
                history[i].url = newUrl;
                history[i].timestamp = Date.now();
                // Move updated item to top
                const item = history.splice(i, 1)[0];
                history.unshift(item);
                updated = true;
            }
            break;
        }
    }

    if (updated) {
        await browser.storage.local.set({ 'download-history': history });
        if (tabId) {
            showSimpleToast(tabId, browser.i18n.getMessage("historyLinkUpdated") || "Link updated successfully.");
        }
    }
}

async function generateTemplateName(template, url, originalName, tabId) {
    let result = template || "{name}";
    let pageTitle = "Media";
    try {
        if (tabId && tabId >= 0) {
            const tab = await browser.tabs.get(tabId);
            if (tab && tab.title) pageTitle = tab.title;
        }
    } catch (e) {}

    const host = new URL(url).hostname;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    // Extract name without extension for {name}
    const lastDotIdx = originalName.lastIndexOf('.');
    const nameWithoutExt = lastDotIdx !== -1 ? originalName.substring(0, lastDotIdx) : originalName;
    const ext = lastDotIdx !== -1 ? originalName.substring(lastDotIdx) : '';

    result = result
        .replace(/{title}/g, pageTitle)
        .replace(/{host}/g, host)
        .replace(/{date}/g, dateStr)
        .replace(/{time}/g, timeStr)
        .replace(/{name}/g, nameWithoutExt);
    
    // Ensure extension is kept if not in template and not already present
    if (ext && !result.toLowerCase().endsWith(ext.toLowerCase())) {
        result += ext;
    }

    // Basic filename sanitization
    return result.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

async function showMediaNotification(details, settings) {
    if (!settings.mediaNotification) return;

    const url = details.url;
    const tabId = details.tabId;
    if (tabId < 0) return;

    // Use base URL (without query/hash) to identify the video to avoid spamming segments
    const baseUrl = url.split('?')[0].split('#')[0];

    // Check if we already notified for this specific video in this tab
    if (!notifiedUrls.has(tabId)) notifiedUrls.set(tabId, new Set());
    const tabNotified = notifiedUrls.get(tabId);
    if (tabNotified.has(baseUrl)) return;

    const responseHeaders = details.responseHeaders || [];
    let contentType = responseHeaders.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
    let contentLength = parseInt(responseHeaders.find(h => h.name.toLowerCase() === 'content-length')?.value || '0');

    // Filter by individual media type settings
    const mediaType = getMediaType(url, contentType);
    const isVideo = mediaType === 'video';
    const isAudio = mediaType === 'audio';
    const isImage = mediaType === 'image';
    const isStream = mediaType === 'stream';
    const isSubtitle = mediaType === 'subtitle';

    // Only show if the respective category toggle is ON
    if (isVideo && !settings.onlyVideo) return;
    if (isAudio && !settings.onlyAudio) return;
    if (isStream && !settings.onlyStream) return;
    if (isImage && !settings.onlyImage) return;
    if (isSubtitle && !settings.onlySubtitle) return;

    // Discard if it doesn't match any known media category
    if (!mediaType) return;

    // Filter by hideSegments setting
    const isSegment = url.toLowerCase().includes('.ts') || (contentLength > 0 && contentLength < 1048576 && contentType === 'video/mp2t');
    if (settings.hideSegments && isSegment) return;

    const now = Date.now();
    // Short cooldown (2 seconds) just to prevent overlapping toasts for multiple videos detected simultaneously
    if (lastNotificationTime.has(tabId) && (now - lastNotificationTime.get(tabId) < 2000)) {
        return;
    }

    tabNotified.add(baseUrl);
    lastNotificationTime.set(tabId, now);

    const originalFilename = getFileName(url, 50);
    let displayFilename = originalFilename;

    if (settings.filenameTemplate) {
        displayFilename = await generateTemplateName(settings.filenameTemplate, url, originalFilename, tabId);
    }

    // NEW: Automatically update history link if we found a match for this page and filename
    let pageUrl = "";
    try {
        const tab = await browser.tabs.get(tabId);
        if (tab) pageUrl = tab.url;
    } catch (e) {}
    
    if (pageUrl) {
        autoUpdateHistoryLink(pageUrl, displayFilename, url, tabId);
    }
    
    // Fallback: Inject in-page toast for environments where browser.notifications might not work (e.g. Firefox Android)
    injectNotificationScript(tabId, displayFilename, url);

    browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("src/icons/icon.svg"),
        title: browser.i18n.getMessage("mediaNotificationTitle") || "Media detected!",
        message: displayFilename,
        buttons: [
            { title: browser.i18n.getMessage("mediaNotificationDownloadAction") || "Download" }
        ]
    }, (notificationId) => {
        if (browser.runtime.lastError) {
            console.warn("Notification error (normal in some mobile browsers):", browser.runtime.lastError.message);
        }
        notificationUrls.set(notificationId, { url, tabId });
    });
}

browser.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const data = notificationUrls.get(notificationId);
    if (data && buttonIndex === 0) {
        browser.storage.session.get(data.url, async (result) => {
            const requests = result[data.url];
            if (requests && requests.length > 0) {
                const request = requests[requests.length - 1];
                let pageUrl = "";
                let pageTitle = "";
                try {
                    const tab = await browser.tabs.get(data.tabId);
                    if (tab) {
                        pageUrl = tab.url;
                        pageTitle = tab.title;
                    }
                } catch (e) {}

                browser.storage.local.get(['download-method', 'filename-template'], async (res) => {
                    const method = res['download-method'] || 'browser';
                    const template = res['filename-template'];
                    const originalName = getFileName(data.url);
                    let finalName = originalName;

                    if (template) {
                        finalName = await generateTemplateName(template, data.url, originalName, data.tabId);
                    }

                    addToHistory({ url: data.url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });

                    if (method === 'fetch') {
                        handleFetchDownload(data.url, finalName, request);
                    } else {
                        browser.downloads.download({
                            url: data.url,
                            filename: finalName,
                            saveAs: false
                        });
                    }
                });
            }
        });
    }
    notificationUrls.delete(notificationId);
});

browser.notifications.onClicked.addListener((notificationId) => {
    browser.tabs.create({
        url: browser.runtime.getURL(`popup.html`),
    });
    notificationUrls.delete(notificationId);
});

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
                    contentType.startsWith('image/') ||
                    contentType.includes('mpegurl') ||
                    contentType.includes('dash+xml') ||
                    contentType.includes('vtt') ||
                    contentType.includes('subrip') ||
                    contentType.includes('ass') ||
                    contentType.includes('ttml') ||
                    contentType.includes('dfxp') ||
                    contentType === 'application/octet-stream' // treat generic binary as potential media
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

                        // NEW: Show notification if media was detected
                        if (shouldSaveNow || updated) {
                            showMediaNotification(details, currentSettings);
                        }
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
        if (delta.state.current === 'complete') {
            removeMediaRequest(item.url);
        }
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
    if (message.action === 'addToHistory') {
        addToHistory(message.item);
        return;
    }
    if (message.action === 'startDownloadFromToast') {
        const url = message.url;
        const tabId = sender.tab ? sender.tab.id : null;
        browser.storage.session.get(url, (result) => {
            const requests = result[url] || [];
            const request = requests.length > 0 ? requests[requests.length - 1] : null;
            browser.storage.local.get(['download-method', 'filename-template'], async (res) => {
                const method = res['download-method'] || 'browser';
                const template = res['filename-template'];
                const originalName = getFileName(url);
                let finalName = originalName;

                let pageUrl = sender.tab ? sender.tab.url : "";
                let pageTitle = sender.tab ? sender.tab.title : "";

                if (template) {
                    finalName = await generateTemplateName(template, url, originalName, tabId);
                }

                addToHistory({ url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });

                if (method === 'fetch') {
                    handleFetchDownload(url, finalName, request);
                } else {
                    browser.downloads.download({
                        url: url,
                        filename: finalName,
                        saveAs: false
                    });
                }
            });
        });
        return;
    }
    if (message.action === 'reportDetectedMedia') {
        const { urls } = message;
        if (!urls || !Array.isArray(urls)) return;

        browser.storage.session.get(null, (items) => {
            const updates = {};
            let hasNew = false;
            
            urls.forEach(url => {
                if (!items[url]) {
                    updates[url] = [{
                        url: url,
                        method: 'GET',
                        requestHeaders: null,
                        responseHeaders: null,
                        requestBody: null,
                        cookie: '',
                        size: 'unknown',
                        timeStamp: Date.now()
                    }];
                    hasNew = true;
                }
            });

            if (hasNew) {
                browser.storage.session.set(updates);
            }
        });
        return;
    }
    if (message.action === 'getMediaRequests') {
        browser.storage.session.get(null, function (items) {
            sendResponse(items);
        });
        return true; // Indicate that the response will be sent asynchronously
    }

    if (message.action === 'getSpoofedHeaders') {
        sendResponse(urlToHeaderMap.get(message.url) || null);
        return true;
    }

    if (message.action === 'startFetchDownload') {
        handleFetchDownload(message.url, message.filename, message.request, message.downloadId);
        return true;
    }

    if (message.action === 'startDownloadAll') {
        const downloadId = 'zip_' + Date.now();
        handleDownloadAllAsZip(message.items, downloadId);
        sendResponse({ downloadId });
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
            } else if (item && item.abortController) {
                item.abortController.abort();
                activeDownloads.delete(targetId);
                removeDownloadState(targetId);
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

async function handleDownloadAllAsZip(items, downloadId) {
    try {
        const zipEntries = [];
        activeDownloads.set(downloadId, { loaded: 0, total: items.length, url: 'zip://' + downloadId, isZip: true });

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const url = item.url;
            const filename = item.filename;

            // Update progress
            browser.runtime.sendMessage({
                action: 'zipProgress',
                id: downloadId,
                loaded: i,
                total: items.length,
                status: 'downloading',
                currentFile: filename
            }).catch(() => {});

            // Fetch the item with spoofed headers
            const storedHeaders = urlToHeaderMap.get(url);
            const fetchOptions = {
                credentials: 'include',
                headers: {}
            };
            if (storedHeaders) {
                if (storedHeaders.cookie) fetchOptions.headers['Cookie'] = storedHeaders.cookie;
                if (storedHeaders.referer) {
                    fetchOptions.headers['Referer'] = storedHeaders.referer;
                    fetchOptions.referrer = storedHeaders.referer;
                }
                if (storedHeaders.origin) fetchOptions.headers['Origin'] = storedHeaders.origin;
            }

            const response = await fetch(url, fetchOptions);
            if (!response.ok) throw new Error(`Failed to download ${url}`);
            
            const blob = await response.blob();
            zipEntries.push({ name: filename, input: blob });

            activeDownloads.get(downloadId).loaded = i + 1;
        }

        // Generate Zip
        browser.runtime.sendMessage({
            action: 'zipProgress',
            id: downloadId,
            loaded: items.length,
            total: items.length,
            status: 'generating'
        }).catch(() => {});

        const zipBlob = await downloadZip(zipEntries).blob();
        const zipName = `downloads_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

        // Store Zip in IndexedDB
        await storeInCache(downloadId, zipBlob, "application/zip");
        
        pendingSaveQueue.push({ id: downloadId, url: 'zip://' + downloadId, filename: zipName });
        processSaveQueue();

        activeDownloads.delete(downloadId);
        browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName }).catch(() => {});

    } catch (error) {
        console.error("Background ZIP error:", error);
        activeDownloads.delete(downloadId);
        browser.runtime.sendMessage({ action: 'zipError', id: downloadId, error: error.message }).catch(() => {});
    }
}

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

async function cleanupDownload(id) {
    try {
        const db = await getDB();
        const delTx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
        delTx.objectStore(STORE_NAME).delete(id);
        const chunkRange = IDBKeyRange.bound([id, 0], [id, Infinity]);
        delTx.objectStore(CHUNK_STORE_NAME).delete(chunkRange);
    } catch (e) { console.warn("Cleanup failed:", e); }
}

async function triggerHiddenDownload(id, filename) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isFirefox = typeof browser.runtime.getBrowserInfo === 'function' || !browser.offscreen;

    // ON ANDROID: Direct hidden downloads (Blobs) are extremely unreliable.
    // They often fail because the system download manager cannot access the Blob URL
    // from a background context or the context is killed too early.
    // We will return false here to force the use of a visible tab (download.html).
    if (isAndroid) {
        return false;
    }

    // 1. Try direct URL.createObjectURL (Only for Desktop Firefox)
    if (isFirefox && typeof URL !== 'undefined' && URL.createObjectURL) {
        try {
            const db = await getDB();
            
            const item = await new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], "readonly");
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(id);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            
            const chunks = [];
            await new Promise((resolve, reject) => {
                const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
                const store = tx.objectStore(CHUNK_STORE_NAME);
                const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
                const request = store.openCursor(range);
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) { chunks.push(cursor.value.data); cursor.continue(); }
                    else resolve();
                };
                request.onerror = () => reject(request.error);
            });

            if (chunks.length === 0 && (!item || !item.data)) return false;

            const finalBlob = chunks.length > 0 
                ? new Blob(chunks, { type: (item && item.mime) || "application/octet-stream" })
                : item.data;

            const blobUrl = URL.createObjectURL(finalBlob);
            
            try {
                await browser.downloads.download({
                    url: blobUrl,
                    filename: filename,
                    saveAs: false
                });
                
                setTimeout(() => {
                    URL.revokeObjectURL(blobUrl);
                    cleanupDownload(id);
                }, 30000); 
                return true;
            } catch (e) {
                URL.revokeObjectURL(blobUrl);
                throw e;
            }
        } catch (e) {
            console.error("Direct background download failed:", e);
        }
    }

    // 2. Try Offscreen API (Desktop Chromium)
    if (typeof browser.offscreen !== 'undefined') {
        try {
            const hasOffscreen = await browser.offscreen.hasDocument().catch(() => false);
            if (!hasOffscreen) {
                await browser.offscreen.createDocument({
                    url: 'offscreen.html',
                    reasons: ['DOWNLOAD'],
                    justification: 'Triggering download for fetched media blob'
                });
            }
            
            const response = await browser.runtime.sendMessage({
                action: 'triggerOffscreenDownload',
                data: { id, filename }
            }).catch(e => ({ error: e.message }));

            if (response && response.success) {
                setTimeout(() => {
                    cleanupDownload(id);
                }, 10000);
                return true;
            }
        } catch (e) {
            console.error("Offscreen download failed:", e);
        }
    }

    return false;
}

async function processSaveQueue() {
    if (activeBridgeTabId !== null || pendingSaveQueue.length === 0) return;

    const nextDownload = pendingSaveQueue.shift();
    const { id, url, filename } = nextDownload;

    // Try hidden download (only works on Desktop)
    const hiddenSuccess = await triggerHiddenDownload(id, filename);
    if (hiddenSuccess) {
        setTimeout(processSaveQueue, 1000);
        return;
    }

    // ON ANDROID / FALLBACK: Use a visible tab.
    // We MUST use active: true on Android because many browsers block downloads
    // from background tabs or require a user gesture that only works in the active tab.
    const isAndroid = /Android/i.test(navigator.userAgent);
    const tab = await browser.tabs.create({
        url: browser.runtime.getURL(`download.html?id=${id}&url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`),
        active: isAndroid // Force active on Android for reliability
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

async function handleParallelFetchDownload(url, filename, total, connections, baseOptions, downloadId, providedContentType = null) {
    const abortController = new AbortController();
    baseOptions.signal = abortController.signal;

    try {
        activeDownloads.set(downloadId, { loaded: 0, total: total, abortController: abortController, url: url });
        await saveDownloadState(downloadId, { url, filename, total, loaded: 0, originalRequest: null, isParallel: true });

        const partSize = Math.ceil(total / connections);
        const BUFFER_THRESHOLD = 1024 * 1024; // 1MB buffer
        let totalLoaded = 0;
        let lastReportTime = 0;

        const partPromises = [];

        for (let i = 0; i < connections; i++) {
            const start = i * partSize;
            const end = Math.min((i + 1) * partSize - 1, total - 1);
            if (start >= total) break;

            partPromises.push((async (partIndex) => {
                const partOptions = {
                    ...baseOptions,
                    headers: {
                        ...baseOptions.headers,
                        'Range': `bytes=${start}-${end}`
                    }
                };

                const response = await fetch(url, partOptions);
                if (!response.ok && response.status !== 206) {
                    throw new Error(`Part ${partIndex} failed with status ${response.status}`);
                }

                const reader = response.body.getReader();
                let localChunkIndex = 0;
                let currentBuffer = [];
                let currentBufferSize = 0;

                async function flushPartBuffer() {
                    if (currentBuffer.length === 0) return;
                    const combined = new Uint8Array(currentBufferSize);
                    let offset = 0;
                    for (const b of currentBuffer) {
                        combined.set(b, offset);
                        offset += b.length;
                    }
                    
                    // Use a unique chunk index for this part to keep ordering
                    // partIndex * 1,000,000 allows 1TB per part with 1MB chunks
                    const globalChunkIndex = (partIndex * 1000000) + localChunkIndex++;
                    await storeChunkInCache(downloadId, globalChunkIndex, combined);
                    
                    currentBuffer = [];
                    currentBufferSize = 0;
                    
                    // Periodically update state in storage
                    saveDownloadState(downloadId, { url, filename, total, loaded: totalLoaded, originalRequest: null, isParallel: true });
                }

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    currentBuffer.push(value);
                    currentBufferSize += value.length;
                    totalLoaded += value.length;

                    // Update global progress
                    activeDownloads.set(downloadId, { loaded: totalLoaded, total: total, abortController, url: url });
                    
                    const now = Date.now();
                    if (now - lastReportTime > 200) {
                        lastReportTime = now;
                        browser.runtime.sendMessage({
                            action: 'downloadProgress',
                            id: downloadId,
                            url: url,
                            loaded: totalLoaded,
                            total: total
                        }).catch(() => {});
                    }

                    if (currentBufferSize >= BUFFER_THRESHOLD) {
                        await flushPartBuffer();
                    }
                }
                await flushPartBuffer();
            })(i));
        }

        await Promise.all(partPromises);

        // Final progress report
        browser.runtime.sendMessage({
            action: 'downloadProgress',
            id: downloadId,
            url: url,
            loaded: totalLoaded,
            total: total
        }).catch(() => {});

        const finalFilename = filename || getFileName(url);
        const contentType = providedContentType || baseOptions.headers['Content-Type'] || 'application/octet-stream';
        await storeInCache(downloadId, null, contentType);
        
        pendingSaveQueue.push({ id: downloadId, url, filename: finalFilename });
        processSaveQueue();

        activeDownloads.delete(downloadId);
        removeDownloadState(downloadId);
        removeMediaRequest(url);
        browser.runtime.sendMessage({ action: 'downloadComplete', id: downloadId, url: url }).catch(() => {});

    } catch (error) {
        activeDownloads.delete(downloadId);
        removeDownloadState(downloadId); // Clear state on error
        if (error.name === 'AbortError') {
            console.log("Parallel download aborted.");
            browser.runtime.sendMessage({ action: 'downloadError', url: url, error: 'USER_CANCELED' }).catch(() => {});
        } else {
            console.error("Parallel download failed:", error);
            browser.runtime.sendMessage({ action: 'downloadError', url: url, error: error.message }).catch(() => {});
        }
    }
}

async function handleFetchDownload(url, filename, originalRequest = null, providedId = null, isResuming = false) {
    const settings = await browser.storage.local.get(['speed-boost', 'connections']);
    const speedBoostEnabled = settings['speed-boost'] === '1';
    const connections = parseInt(settings['connections'] || '4', 10);

    const abortController = new AbortController();
    const downloadId = providedId || ('dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    
    let resumeOffset = 0;
    let chunkIndex = 0;

    if (isResuming) {
        try {
            const db = await getDB();
            const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
            const store = tx.objectStore(CHUNK_STORE_NAME);
            const range = IDBKeyRange.bound([downloadId, 0], [downloadId, Infinity]);
            const cursorRequest = store.openCursor(range, "prev"); // Get last chunk
            
            const lastChunk = await new Promise((resolve) => {
                cursorRequest.onsuccess = (e) => resolve(e.target.result ? e.target.result.value : null);
                cursorRequest.onerror = () => resolve(null);
            });

            if (lastChunk) {
                chunkIndex = lastChunk.chunkIndex + 1;
                // We need the total loaded bytes to resume correctly
                const allChunksTx = db.transaction([CHUNK_STORE_NAME], "readonly");
                const allChunksStore = allChunksTx.objectStore(CHUNK_STORE_NAME);
                const allChunksReq = allChunksStore.getAll(range);
                const chunks = await new Promise(r => {
                    allChunksReq.onsuccess = () => r(allChunksReq.result);
                    allChunksReq.onerror = () => r([]);
                });
                resumeOffset = chunks.reduce((acc, c) => acc + c.data.length, 0);
            }
        } catch (e) {
            console.error("Failed to calculate resume offset:", e);
        }
    }

    try {
        const fetchOptions = {
            method: originalRequest ? originalRequest.method : 'GET',
            headers: {},
            credentials: 'include', // Important for cookies
            signal: abortController.signal
        };

        if (resumeOffset > 0) {
            fetchOptions.headers['Range'] = `bytes=${resumeOffset}-`;
        }

        if (originalRequest && originalRequest.requestHeaders) {
            originalRequest.requestHeaders.forEach(h => {
                const name = h.name.toLowerCase();
                if (name !== 'cookie' && name !== 'referer' && name !== 'range') {
                    fetchOptions.headers[h.name] = h.value;
                }
            });
        }

        // Add cookies, referer and origin if available
        const storedHeaders = urlToHeaderMap.get(url);
        if (storedHeaders) {
            if (storedHeaders.cookie) {
                fetchOptions.headers['Cookie'] = storedHeaders.cookie;
            }
            if (storedHeaders.referer) {
                fetchOptions.referrer = storedHeaders.referer;
                fetchOptions.headers['Referer'] = storedHeaders.referer;
            }
            if (storedHeaders.origin) {
                fetchOptions.headers['Origin'] = storedHeaders.origin;
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
        if (!response.ok && response.status !== 206) throw new Error("Server error: " + response.status);

        const contentLength = response.headers.get('content-length');
        const total = (contentLength ? parseInt(contentLength, 10) : 0) + resumeOffset;
        const acceptRanges = response.headers.get('accept-ranges');
        const supportsRanges = acceptRanges === 'bytes';
        const contentType = response.headers.get('content-type');

        if (!isResuming && speedBoostEnabled && supportsRanges && total > 2 * 1024 * 1024 && connections > 1) {
            // Cancel current single stream and switch to parallel
            // We use reader.cancel() if supported or just abort the controller
            if (response.body && response.body.cancel) {
                response.body.cancel();
            } else {
                abortController.abort();
            }
            
            // Re-prepare options for parallel (new signal)
            const parallelOptions = { ...fetchOptions };
            delete parallelOptions.signal; 
            
            return handleParallelFetchDownload(url, filename, total, connections, parallelOptions, downloadId, contentType);
        }
        
        activeDownloads.set(downloadId, { loaded: resumeOffset, total: total, abortController: abortController, url: url });
        await saveDownloadState(downloadId, { url, filename, total, loaded: resumeOffset, originalRequest });

        const reader = response.body.getReader();
        let loaded = resumeOffset;
        let lastReportTime = 0;
        
        const writeQueue = [];
        const MAX_WRITE_QUEUE = 3; 

        let currentBuffer = [];
        let currentBufferSize = 0;
        const BUFFER_THRESHOLD = 1024 * 1024; // 1MB buffer

        async function flushBuffer() {
            if (currentBuffer.length === 0) return;
            const bufferToSource = currentBuffer;
            const sizeToSource = currentBufferSize;
            currentBuffer = [];
            currentBufferSize = 0;

            const combined = new Uint8Array(sizeToSource);
            let offset = 0;
            for (const b of bufferToSource) {
                combined.set(b, offset);
                offset += b.length;
            }
            
            const writePromise = storeChunkInCache(downloadId, chunkIndex++, combined);
            writeQueue.push(writePromise);
            if (writeQueue.length >= MAX_WRITE_QUEUE) {
                await writeQueue.shift();
            }
            // Periodically update state in storage
            saveDownloadState(downloadId, { url, filename, total, loaded, originalRequest });
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            currentBuffer.push(value);
            currentBufferSize += value.length;
            loaded += value.length;
            activeDownloads.set(downloadId, { loaded, total, abortController, url: url });

            // Update UI frequently
            const now = Date.now();
            if (now - lastReportTime > 100) {
                lastReportTime = now;
                browser.runtime.sendMessage({
                    action: 'downloadProgress',
                    id: downloadId,
                    url: url,
                    loaded: loaded,
                    total: total
                }).catch(() => {});
            }

            if (currentBufferSize >= BUFFER_THRESHOLD) {
                await flushBuffer();
            }
        }
        
        await flushBuffer();
        
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
        await storeInCache(downloadId, null, contentType);
        
        // Add to queue instead of opening immediately
        pendingSaveQueue.push({ id: downloadId, url, filename: finalFilename });
        processSaveQueue();

        activeDownloads.delete(downloadId);
        removeDownloadState(downloadId);
        removeMediaRequest(url);
        browser.runtime.sendMessage({ action: 'downloadComplete', id: downloadId, url: url }).catch(() => {});

    } catch (error) {
        // Find the downloadId if possible to cleanup
        let targetId = downloadId;
        if (targetId) activeDownloads.delete(targetId);
        
        if (error.name === 'AbortError') {
            console.log("Download aborted by user or system.");
            browser.runtime.sendMessage({ action: 'downloadError', url: url, error: 'USER_CANCELED' }).catch(() => {});
            removeDownloadState(targetId); // Also cleanup on manual abort to be sure
        } else {
            console.error("Background fetch download failed:", error);
            browser.runtime.sendMessage({ action: 'downloadError', url: url, error: error.message }).catch(() => {});
            // [NEW] Clear state on error to avoid infinite retry loops on startup if the error is persistent
            removeDownloadState(targetId);
        }
    }
}


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
    } else if (message.action === 'removeMedia') {
        if (message.url) {
            browser.storage.session.remove(message.url);
        }
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

    const requestBuffers = new Map(); // requestId -> { chunks: [], size: 0, index: 0 }

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

            const downloadId = details.url; // For auto-cache, we use URL as ID
            requestBuffers.set(details.requestId, { chunks: [], size: 0, index: 0 });

            const flushBuffer = async (reqId) => {
                const state = requestBuffers.get(reqId);
                if (!state || state.chunks.length === 0) return;

                const combined = new Uint8Array(state.size);
                let offset = 0;
                for (const b of state.chunks) {
                    combined.set(new Uint8Array(b), offset);
                    offset += b.byteLength;
                }
                const currentIndex = state.index++;
                state.chunks = [];
                state.size = 0;

                await storeChunkInCache(downloadId, currentIndex, combined);
            };

            filter.ondata = (event) => {
                try {
                    // Write back to browser IMMEDIATELY to avoid blocking rendering
                    filter.write(event.data);
                    
                    const state = requestBuffers.get(details.requestId);
                    if (state) {
                        state.chunks.push(event.data);
                        state.size += event.data.byteLength;

                        if (state.size >= 1024 * 1024) { // 1MB buffer
                            flushBuffer(details.requestId).catch(err => console.error("Failed to flush buffer:", err));
                        }
                    }
                } catch (e) {
                    console.error("Error writing chunk back to filter:", e);
                }
            };
            filter.onstop = async () => {
                try {
                    await flushBuffer(details.requestId);
                    requestBuffers.delete(details.requestId);
                    filter.disconnect();
                    // Store metadata in cache to signal chunked download
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
