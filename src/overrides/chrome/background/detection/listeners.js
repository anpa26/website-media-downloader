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

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

let beforeRequestListener, beforeSendHeadersListener, cleanupListener;

function initListener(skipCacheReset = false) {
    urlList = ["<all_urls>"];

    getSettings(function (settings) {
        const mimeEnabled = !!settings.mimeDetection;
        const urlEnabled = !!settings.urlDetection;

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

        if (!mimeEnabled && !urlEnabled) {
            if (cleanupListener) {
                browser.webRequest.onCompleted.removeListener(cleanupListener);
                browser.webRequest.onErrorOccurred.removeListener(cleanupListener);
            }
            return;
        }

        if (!skipCacheReset) openCacheDB().then(db => {
            const tx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
            tx.objectStore(STORE_NAME).clear();
            tx.objectStore(CHUNK_STORE_NAME).clear();
        }).catch(e => console.error("Failed to clear IndexedDB cache on init:", e));

        cleanupListener ||= (details) => {
            if (temporaryHeaderMap.has(details.requestId)) {
                temporaryHeaderMap.delete(details.requestId);
            }
            if (temporaryRequestBodyMap.has(details.requestId)) {
                temporaryRequestBodyMap.delete(details.requestId);
            }
            if (temporaryCookieMap.has(details.requestId)) {
                temporaryCookieMap.delete(details.requestId);
            }
        };

        if (!browser.webRequest.onCompleted.hasListener(cleanupListener)) {
            browser.webRequest.onCompleted.addListener(cleanupListener, { urls: ["<all_urls>"] });
            browser.webRequest.onErrorOccurred.addListener(cleanupListener, { urls: ["<all_urls>"] });
        }

        beforeRequestListener = function (details) {
            try {
                if (!details || !details.requestBody) return;
                const mType = getMediaType(details.url);
                if (isMediaTypeDisabled(mType, cachedSettings)) return;

                const rb = details.requestBody;

                if (rb.formData) {

                    temporaryRequestBodyMap.set(details.requestId, { type: 'formData', data: rb.formData });
                } else if (rb.raw && rb.raw.length) {

                    try {

                        let totalLen = 0;
                        for (let part of rb.raw) {
                            if (part && part.bytes) {
                                totalLen += part.bytes.byteLength || part.bytes.length || 0;
                            }
                        }
                        if (totalLen === 0) {
                            return;
                        }

                        if (totalLen > 1024 * 1024) {
                            console.debug("Request body too large to capture:", totalLen);
                            temporaryRequestBodyMap.set(details.requestId, { type: 'error', data: 'Body too large to capture' });
                            return;
                        }

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
            const cookie = details.requestHeaders?.find(h => h.name.toLowerCase() === 'cookie')?.value || '';
            temporaryCookieMap.set(details.requestId, cookie);

            return;
        };

        browser.webRequest.onBeforeSendHeaders.addListener(
            beforeSendHeadersListener,
            { urls: urlList },
            ['requestHeaders', 'extraHeaders']
        );

        headersSentListener = async function (details) {
            if (await detectionExclusions.shouldSkip(details)) return;
            try {
                const mType = getMediaType(details.url);
                if (isMediaTypeDisabled(mType, cachedSettings)) return;

                if (details.requestHeaders) {
                    temporaryHeaderMap.set(details.requestId, details.requestHeaders);
                }

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                if (!mimeEnabled && !urlEnabled) {
                    return;
                } else {

                    if (!urlEnabled || (urlEnabled && !urlMatches)) {

                        if (urlEnabled && mimeEnabled && !urlMatches) {

                            return;
                        }
                        if (mimeEnabled && !urlEnabled) {
                            return;
                        }

                    }
                }

                const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;
                const metadata = details.tabId >= 0 ? tabMetadata.get(details.tabId) : null;
                const refererHeader = details.requestHeaders?.find(h => h.name && h.name.toLowerCase() === 'referer')?.value || '';
                const fallbackPageUrl = (metadata && metadata.url) || details.documentUrl || details.originUrl || details.initiator || refererHeader || "";

                let mediaRequest = {
                    url: details.url,
                    method: details.method,
                    requestHeaders: details.requestHeaders,
                    responseHeaders: null,
                    requestBody: cachedBody,
                    cookie: temporaryCookieMap.get(details.requestId) || '',
                    size: null,
                    timeStamp: null,
                    tabId: details.tabId,
                    pageTitle: metadata ? metadata.title : "",
                    pageUrl: fallbackPageUrl
                };

                antreTulisSession(async () => {
                    const result = await browser.storage.session.get(details.url);
                    let existingRequests = result[details.url] || [];

                    existingRequests.push(mediaRequest);
                    let requestsObj = {};
                    requestsObj[details.url] = existingRequests;
                    await browser.storage.session.set(requestsObj);
                }).catch(() => {});
            } catch (e) {
                console.error("Error in onSendHeaders handler:", e);
            }
        };

        browser.webRequest.onSendHeaders.addListener(
            headersSentListener,
            { urls: urlList },
            ['requestHeaders']
        );

        headersReceivedListener = async function (details) {
            if (await detectionExclusions.shouldSkip(details)) return;
            try {

                const responseHeaders = details.responseHeaders || [];
                let size = 'unknown';

                let mediaSizeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-length');
                if (mediaSizeHeader) size = mediaSizeHeader.value;

                let contentRangeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-range');
                if (contentRangeHeader && contentRangeHeader.value.includes('/')) {
                    const totalSize = contentRangeHeader.value.split('/').pop();
                    if (totalSize && totalSize !== '*') {
                        size = totalSize;
                    }
                }

                let contentTypeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-type');
                let contentType = contentTypeHeader ? (contentTypeHeader.value || '').toLowerCase() : '';

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
                    contentType === 'application/octet-stream'
                );

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                antreTulisSession(async () => {
                    const result = await browser.storage.session.get(details.url);
                    let existingRequests = result[details.url] || [];

                    let updated = false;
                    for (let request of existingRequests) {

                        if (!(parseInt(request.size, 10) > 0) && (!request.responseHeaders || request.responseHeaders === null)) {
                            request.size = size;
                            request.responseHeaders = responseHeaders;
                            request.timeStamp = details.timeStamp;
                            updated = true;
                            break;
                        }
                    }

                    await new Promise((selesaiAntrean) => {
                    setTimeout(() => selesaiAntrean(), 10000);
                    getSettings(async function (currentSettings) {
                        const mimeEnabledNow = !!currentSettings.mimeDetection;
                        const urlEnabledNow = !!currentSettings.urlDetection;
                        const mType = getMediaType(details.url, contentType);
                        const shouldSaveNow = (() => {
                            if (isMediaTypeDisabled(mType, currentSettings)) return false;
                            if (checkIsSegment(details.url, contentType, size, currentSettings)) return false;
                            if (!mimeEnabledNow && !urlEnabledNow) return false;
                            if (mimeEnabledNow && mimeMatches) return true;
                            if (urlEnabledNow && urlMatches) return true;
                            return false;
                        })();

                        const isDrm = tabsWithDrm.has(details.tabId);
                        const isDrmMedia = isDrm && (mType === 'video' || mType === 'audio' || mType === 'stream');

                        if (shouldSaveNow) {
                            const cachedHeaders = temporaryHeaderMap.get(details.requestId) || null;
                            const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;
                            
                            let pageTitle = "";
                            let pageUrl = "";
                            try {
                                if (details.tabId >= 0) {
                                    let metadata = tabMetadata.get(details.tabId);
                                    if (metadata && metadata.url) {
                                        pageTitle = metadata.title || "";
                                        pageUrl = metadata.url;
                                    } else {
                                        const tab = await browser.tabs.get(details.tabId);
                                        if (tab) {
                                            pageTitle = tab.title || "";
                                            pageUrl = tab.url || "";
                                            tabMetadata.set(details.tabId, { title: pageTitle, url: pageUrl });
                                        }
                                    }
                                }
                            } catch (e) {}
                            if (!pageUrl) {
                                const refHdr = cachedHeaders?.find(h => h.name && h.name.toLowerCase() === 'referer')?.value || '';
                                pageUrl = details.documentUrl || details.originUrl || details.initiator || refHdr || "";
                            }

                            if (updated && existingRequests.length > 0) {
                                const lastUpdated = existingRequests.find(r => r.timeStamp === details.timeStamp) || existingRequests[existingRequests.length - 1];
                                if (lastUpdated) {
                                    if (!lastUpdated.pageUrl && pageUrl) lastUpdated.pageUrl = pageUrl;
                                    if (!lastUpdated.pageTitle && pageTitle) lastUpdated.pageTitle = pageTitle;
                                    if ((lastUpdated.tabId == null || lastUpdated.tabId < 0) && details.tabId >= 0) lastUpdated.tabId = details.tabId;
                                }
                            } else {
                                let mediaRequest = {
                                    url: details.url,
                                    method: details.method || 'GET',
                                    requestHeaders: cachedHeaders,
                                    responseHeaders: responseHeaders,
                                    requestBody: cachedBody,
                                    cookie: temporaryCookieMap.get(details.requestId) || '',
                                    size: size,
                                    timeStamp: details.timeStamp,
                                    tabId: details.tabId,
                                    pageTitle: pageTitle,
                                    pageUrl: pageUrl
                                };
                                if (!isDrmMedia) {
                                    existingRequests.push(mediaRequest);
                                }
                            }
                        }

                        if (isDrmMedia) {
                            browser.storage.session.remove(details.url);
                        } else {
                            let requestsObj = {};
                            requestsObj[details.url] = existingRequests;
                            browser.storage.session.set(requestsObj).then(() => {
                                if (!currentSettings.manualScan && mType === 'image' && parseInt(size, 10) > 0 && (shouldSaveNow || updated)) {
                                    browser.runtime.sendMessage({ action: 'imageMetadataUpdated', urls: [details.url] }).catch(() => {});
                                }
                            }).catch(() => {});
                        }

                        if (shouldSaveNow && !isDrmMedia) {
                            maybeAutoDownloadMedia(details, currentSettings, existingRequests[existingRequests.length - 1]);
                        }
                        if (!currentSettings.manualScan && (shouldSaveNow || updated)) {
                            showMediaNotification(details, currentSettings);
                        }
                        selesaiAntrean();
                    });
                    });
                }).catch(() => {});
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

browser.downloads.onCreated.addListener((downloadItem) => {
    if (downloadItem.url && (downloadItem.url.startsWith('http') || downloadItem.url.startsWith('blob'))) {
        activeDownloads.set(downloadItem.id, {
            url: downloadItem.url,
            loaded: 0,
            total: downloadItem.totalBytes,
            isNative: true,
            state: downloadItem.state
        });
    }
});

browser.downloads.onChanged.addListener((delta) => {
    let item = activeDownloads.get(delta.id);
    if (!item) {
        golekiDownload({ id: delta.id }).then((dl) => {
            const d = dl && dl[0];
            if (!d || d.state !== 'in_progress') return;
            if (!d.url || !(d.url.startsWith('http') || d.url.startsWith('blob:'))) return;
            if (!detectionRegex.test(d.url) && !urlToHeaderMap.has(d.url)) return;
            activeDownloads.set(d.id, { url: d.url, filename: d.filename, loaded: d.bytesReceived || 0, total: d.totalBytes, isNative: true, state: d.state });
        }).catch(() => {});
        return;
    }

    if (delta.bytesReceived) item.loaded = delta.bytesReceived.current;
    if (delta.totalBytes) item.total = delta.totalBytes.current;
    if (delta.paused) {
        item.isPaused = delta.paused.current;
        updateActiveDownloadsBadge().catch(() => {});
    }
    if (delta.state?.current === 'interrupted' && delta.error?.current !== 'USER_CANCELED') {
        item.isPaused = true;
        updateActiveDownloadsBadge().catch(() => {});
        browser.runtime.sendMessage({ action: 'downloadPaused', id: delta.id,
            loaded: item.loaded, total: item.total }).catch(() => {});
        return;
    }

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

