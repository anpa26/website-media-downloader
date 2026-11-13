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


browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isTrustedExtensionSender(sender)) return;
    if (message.action === 'customStatus') {
        const id = message.id;
        if (id) {
            let item = activeDownloads.get(id);
            if (!item) {
                item = {
                    id: id,
                    url: id,
                    loaded: 0,
                    total: 100,
                    percent: 0,
                    status: 'downloading',
                    isParallel: false,
                    isPaused: false,
                    mediaType: getMediaType(id) || 'audio'
                };
                activeDownloads.set(id, item);
            }
            if (message.percent !== undefined) {
                item.percent = message.percent;
            }
            if (message.text) {
                item.status = message.text;
            }
            if (message.indeterminate) {
                item.loaded = 0;
                item.total = 0;
            }
        }
        return;
    }
    if (message.action === 'download_cached_blob') {
        const downloadId = message.cacheId;
        if (!downloadId || !String(downloadId).startsWith('processed_')) {
            sendResponse({ success: false, error: 'Invalid completed download cache ID' });
            return false;
        }
        const item = {
            url: downloadId, filename: message.filename,
            loaded: Number(message.size) || 0, total: Number(message.size) || 0,
            isCachedSave: true, mediaType: 'file', mime: message.mime || 'application/octet-stream'
        };
        activeDownloads.set(downloadId, item);
        pendingSaveQueue.push({ id: downloadId, url: downloadId, filename: message.filename });
        processSaveQueue();
        sendResponse({ success: true });
        return false;
    }
    if (message.action === 'download_arraybuffer') {
        const blob = new Blob([message.arrayBuffer], { type: message.mime || 'application/octet-stream' });
        const downloadId = 'tab_' + Date.now();
        storeInCache(downloadId, blob, message.mime).then(() => {
            const isAndroid = /Android/i.test(navigator.userAgent);
            browser.tabs.create({
                url: browser.runtime.getURL(`pages/download.html?id=${downloadId}&url=${encodeURIComponent(downloadId)}&filename=${encodeURIComponent(message.filename)}`),
                active: isAndroid
            });
            sendResponse({ success: true });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }
    if (message.action === 'heartbeat') {
        sendResponse({ status: 'alive' });
        return true;
    }
    if (message.action === 'drmDetected' && sender.tab) {
        const tabId = sender.tab.id;
        if (tabsWithDrm.has(tabId)) return;
        tabsWithDrm.add(tabId);

        antreTulisSession(async () => {
            const items = await browser.storage.session.get(null);
            const keysToRemove = [];
            for (const [url, requests] of Object.entries(items)) {
                if (requests && requests.length > 0 && requests[0].tabId === tabId) {
                    const mType = getMediaType(url);
                    if (mType === 'video' || mType === 'audio' || mType === 'stream') {
                        keysToRemove.push(url);
                    }
                }
            }
            if (keysToRemove.length > 0) await browser.storage.session.remove(keysToRemove);
        }).catch(() => {});

        const drmMsg = browser.i18n.getMessage("mediaNotificationDrmMessage") || "DRM Protected";
        const drmTitle = browser.i18n.getMessage("drmWarningTitle") || "DRM Detected";

        for (const [notificationId, data] of notificationUrls.entries()) {
            if (data.tabId === tabId) {
                browser.notifications.clear(notificationId);
                browser.notifications.create({
                    type: "basic",
                    iconUrl: browser.runtime.getURL("icons/icon.png"),
                    title: drmTitle,
                    message: drmMsg,
                    buttons: []
                });
                notificationUrls.delete(notificationId);
            }
        }

        browser.scripting.executeScript({
            target: { tabId: tabId },
            func: (msg) => {
                const toasts = document.querySelectorAll('.mdu-toast');
                toasts.forEach(toast => {
                    const filename = toast.querySelector('.mdu-toast-filename');
                    const title = toast.querySelector('.mdu-toast-title');
                    const actions = toast.querySelector('.mdu-toast-actions');
                    if (filename) {
                        filename.textContent = msg;
                        filename.style.whiteSpace = 'normal';
                    }
                    if (title) title.textContent = "DRM Detected";
                    if (actions) actions.innerHTML = '';
                    toast.style.width = '420px';
                });
            },
            args: [drmMsg]
        }).catch(() => {});

        return;
    }
    if (message.action === 'addToHistory') {
        addToHistory(message.item);
        return;
    }
    if (message.action === 'downloadHlsStream') {
        const pageUrl = sender.tab ? sender.tab.url : "";
        const pageTitle = sender.tab ? sender.tab.title : "";

        let finalName = message.filename;
        if (!finalName.toLowerCase().endsWith('.mp4')) {
            const dotIdx = finalName.lastIndexOf('.');
            if (dotIdx !== -1) {
                finalName = finalName.substring(0, dotIdx);
            }
            finalName += '.mp4';
        }

        addToHistory({ url: message.url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });

        browser.runtime.sendMessage({
            action: 'startPersistentStreamJob', url: message.url, filename: finalName,
            quality: message.quality || 'highest', request: message.request || {}, downloadMethod: 'browser'
        });
        return;
    }
    if (message.action === 'startDownloadFromToast') {
        const url = message.url;
        const tabId = sender.tab ? sender.tab.id : null;
        browser.storage.session.get(url, (result) => {
            const requests = result[url] || [];
            const request = requests.length > 0 ? requests[requests.length - 1] : null;
            browser.storage.local.get(['download-method', 'filename-template', 'gdrive-stream', 'save-to-gdrive', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token', 'stream-download'], async (res) => {
                let method = res['download-method'] || 'browser';
                const isGdriveStream = res['save-to-gdrive'] === '1' && res['gdrive-stream'] === '1' && res['gdrive_token'];
                if (isGdriveStream) method = 'fetch';

                const template = (res['filename-template'] && res['filename-template'] !== '0') ? res['filename-template'] : '';
                const originalName = await getAutomaticFilename(url, tabId, request || {});
                let finalName = originalName;

                let pageUrl = sender.tab ? sender.tab.url : "";
                let pageTitle = sender.tab ? sender.tab.title : "";

                if (template) {
                    finalName = await generateTemplateName(template, url, originalName, tabId);
                }

                const streamPref = res['stream-download'] || 'offline';
                const mType = getMediaType(url);

                if (url.toLowerCase().includes('.m3u8') && streamPref === 'offline') {
                    addToHistory({ url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });
                    browser.runtime.sendMessage({
                        action: 'startPersistentStreamJob', url, filename: finalName,
                        quality: 'highest', request: request || {}, downloadMethod: method
                    });
                    return;
                }
                addToHistory({ url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });

                if (method === 'fetch') {
                    handleFetchDownload(url, finalName, request);
                } else {
                    browser.downloads.download({
                        url: url,
                        filename: sanitizeFilename(finalName),
                        saveAs: false
                    });
                }
            });
        });
        return;
    }

    if (message.action === 'performManualScan') {
        const targetTabId = message.tabId;
        const targetPageUrl = message.pageUrl || '';
        let targetHost = '';
        try { if (targetPageUrl) targetHost = new URL(targetPageUrl).hostname.toLowerCase(); } catch (e) {}
        const stripWww = (h) => (h || '').replace(/^www\./, '');
        const normTargetHost = stripWww(targetHost);
        browser.storage.local.get('manual-scan-keep-tabs', (localRes) => {
            const keepOtherTabs = localRes && (localRes['manual-scan-keep-tabs'] === '1' || localRes['manual-scan-keep-tabs'] === true);
            antreTulisSession(async () => {
            const items = await browser.storage.session.get(null);
            const updates = {};
            const allEntries = Object.entries(items || {}).filter(([, reqs]) => Array.isArray(reqs) && reqs.length > 0);
            let matchedUrlsCount = 0;

            for (const [url, reqs] of allEntries) {
                const matchesTab = reqs.some(r => {
                    if (!r) return false;
                    if (r.isManual) return true;
                    if (targetTabId != null && targetTabId >= 0 && r.tabId === targetTabId) return true;
                    if (normTargetHost) {
                        const candidates = [r.pageUrl];
                        if (Array.isArray(r.requestHeaders)) {
                            for (const h of r.requestHeaders) {
                                const name = h?.name?.toLowerCase();
                                if ((name === 'referer' || name === 'origin') && h.value) candidates.push(h.value);
                            }
                        }
                        for (const cand of candidates) {
                            if (!cand) continue;
                            try {
                                const candHost = stripWww(new URL(cand).hostname.toLowerCase());
                                if (candHost && (candHost === normTargetHost || candHost.endsWith('.' + normTargetHost) || normTargetHost.endsWith('.' + candHost))) {
                                    return true;
                                }
                            } catch (e) {}
                        }
                    }
                    if ((r.tabId == null || r.tabId < 0) && !r.pageUrl) return true;
                    return false;
                });
                if (matchesTab) {
                    matchedUrlsCount++;
                    let changed = false;
                    reqs.forEach(r => {
                        if (r && !r.manualScanned) {
                            r.manualScanned = true;
                            changed = true;
                        }
                    });
                    if (changed) updates[url] = reqs;
                } else if (!keepOtherTabs && (targetTabId != null || normTargetHost)) {
                    let changed = false;
                    reqs.forEach(r => {
                        if (r && r.manualScanned && !r.isManual) {
                            r.manualScanned = false;
                            changed = true;
                        }
                    });
                    if (changed) updates[url] = reqs;
                }
            }


            const finish = () => sendResponse({ success: true, markedCount: Object.keys(updates).length });
            if (Object.keys(updates).length > 0) {
                await browser.storage.session.set(updates).catch(() => {});
            }
            finish();
            }).catch(() => {});
        });
        return true;
    }

    if (message.action === 'reportDetectedMedia') {
        getSettings(async function(settings) {
            let { urls, pageTitle, pageUrl, imageDimensions, imageSizes, isManualScan } = message;
            if (!urls || !Array.isArray(urls)) return;
            const exclusionContext = {
                pageTitle: pageTitle || sender.tab?.title,
                pageUrl: pageUrl || sender.tab?.url,
                tabId: sender.tab?.id
            };
            if (await detectionExclusions.shouldSkip(exclusionContext)) return;
            urls = urls.filter(url => !detectionExclusions.matchesDetection({ ...exclusionContext, url }));
            if (!urls.length) return;
            if (settings.ignoreDisabledTypes) {
                urls = urls.filter(u => {
                    const mType = getMediaType(u);
                    return !isMediaTypeDisabled(mType, settings);
                });
            }

            let senderReferer = pageUrl || sender.tab?.url || "";
            const tabId = sender.tab?.id;
            
            if (tabId && pageTitle) {
                tabMetadata.set(tabId, { title: pageTitle, url: pageUrl || sender.tab?.url });
            }

            const isDrmTab = tabId && tabsWithDrm.has(tabId);
            let senderOrigin = "";
            try { if (senderReferer) senderOrigin = new URL(senderReferer).origin; } catch(e) {}

            antreTulisSession(async () => {
                const items = await browser.storage.session.get(null);
                const updates = {};
                const imageMetadataUpdates = {};
                let hasNew = false;

                urls.forEach(url => {
                    const mType = getMediaType(url);
                    if (isMediaTypeDisabled(mType, settings)) return;
                    const isDrmMedia = isDrmTab && (mType === 'video' || mType === 'audio' || mType === 'stream');
                    const dimensions = imageDimensions && imageDimensions[url];
                    const imageWidth = Number(dimensions?.width);
                    const imageHeight = Number(dimensions?.height);
                    const imageSize = Number(imageSizes?.[url]);
                    const validImageDimensions = mType === 'image' &&
                        Number.isInteger(imageWidth) && Number.isInteger(imageHeight) &&
                        imageWidth > 0 && imageHeight > 0 && imageWidth <= 30000 && imageHeight <= 30000;
                    const validImageSize = mType === 'image' && Number.isSafeInteger(imageSize) && imageSize > 0 && imageSize <= 100 * 1024 * 1024 * 1024;

                    if (!items[url] && !isDrmMedia) {
                        updates[url] = [{
                            url: url,
                            method: 'GET',
                            requestHeaders: senderReferer ? [{name: 'Referer', value: senderReferer}, {name: 'Origin', value: senderOrigin}] : null,
                            responseHeaders: null,
                            requestBody: null,
                            cookie: '',
                            size: validImageSize ? imageSize : 'unknown',
                            timeStamp: Date.now(),
                            tabId: tabId,
                            pageTitle: pageTitle || sender.tab?.title || "",
                            pageUrl: pageUrl || sender.tab?.url || "",
                            ...(validImageDimensions ? { imageWidth, imageHeight } : {}),
                            ...(isManualScan ? { manualScanned: true } : {})
                        }];
                        hasNew = true;
                    } else if (items[url] && (validImageDimensions || validImageSize || isManualScan) && !isDrmMedia) {
                        const existing = Array.isArray(items[url]) ? items[url] : [];
                        if (existing.length) {
                            let requestChanged = false;
                            existing.forEach(request => {
                                if (isManualScan && !request.manualScanned) {
                                    request.manualScanned = true;
                                    requestChanged = true;
                                }
                                if (validImageDimensions && (request.imageWidth !== imageWidth || request.imageHeight !== imageHeight)) {
                                    request.imageWidth = imageWidth;
                                    request.imageHeight = imageHeight;
                                    requestChanged = true;
                                }
                                if (validImageSize && !(parseInt(request.size, 10) > 0)) {
                                    request.size = imageSize;
                                    requestChanged = true;
                                }
                            });
                            if (requestChanged) imageMetadataUpdates[url] = existing;
                        }
                    }
                });

                if (Object.keys(updates).length) await browser.storage.session.set(updates);
                if (Object.keys(imageMetadataUpdates).length) {
                    try {
                        await browser.storage.session.set(imageMetadataUpdates);
                        if (!settings.manualScan || isManualScan) {
                            browser.runtime.sendMessage({ action: 'imageMetadataUpdated', urls: Object.keys(imageMetadataUpdates) }).catch(() => {});
                        }
                    } catch (_) {}
                }
                updateActiveDownloadsBadge().catch(() => {});
                if (hasNew) {
                    for (const url in updates) {
                        const req = updates[url][0];
                        const detectedType = getMediaType(url) || (url.includes('mime=audio') || url.includes('#audio') ? 'audio' : 'video');
                        maybeAutoDownloadMedia({ url, tabId: tabId ?? req.tabId, pageUrl: req.pageUrl, pageTitle: req.pageTitle, responseHeaders: [{ name: 'content-type', value: detectedType === 'video' ? 'video/mp4' : (detectedType === 'audio' ? 'audio/mp4' : 'application/octet-stream') }] }, settings, req);
                    }
                }
            }).catch(() => {});
        });
        return;
    }
        if (message.action === 'getMediaRequests') {
        const onlyUrl = typeof message.url === 'string' && message.url ? message.url : null;
        browser.storage.session.get(onlyUrl || null, async function (items) {
            await detectionExclusions.ready;
            items = Object.fromEntries(Object.entries(items || {}).map(([url, requests]) => [
                url, Array.isArray(requests) ? requests.filter(request => !detectionExclusions.matches({ ...request, url })) : []
            ]).filter(([, requests]) => requests.length));
            if (cachedSettings.ignoreDisabledTypes) {
                const filtered = {};
                for (const [url, reqs] of Object.entries(items || {})) {
                    const contentType = (reqs && reqs.length > 0 && reqs[0].responseHeaders)
                        ? (reqs[0].responseHeaders.find(h => h.name && h.name.toLowerCase() === 'content-type')?.value || '')
                        : '';
                    const mType = getMediaType(url, contentType);
                    if (!isMediaTypeDisabled(mType, cachedSettings)) {
                        filtered[url] = reqs;
                    }
                }
                sendResponse(filtered);
            } else {
                sendResponse(items);
            }
        });
        return true;
    }

    if (message.action === 'getSpoofedHeaders') {
        let headers = golekHeaderTersimpen(message.url, true);
        if (!headers && (message.url.includes('googlevideo.com') || message.url.includes('youtube.com'))) {
            headers = {
                'referer': 'https://www.youtube.com/',
                'origin': 'https://www.youtube.com',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };
            urlToHeaderMap.set(message.url, { ...headers, disimpen: Date.now() });
            if (typeof registerHeaderSpoofRules === 'function') {
                registerHeaderSpoofRules(message.url, headers);
            }
        }
        sendResponse(headers);
        return;
    }

    if (message.action === 'fetchText') {
        const fetchHeaders = golekHeaderTersimpen(message.url, true) || {};
        const options = { headers: {} };
        if (fetchHeaders.cookie) options.headers['Cookie'] = fetchHeaders.cookie;
        if (fetchHeaders.referer) {
            options.headers['Referer'] = fetchHeaders.referer;
        }
        if (fetchHeaders.origin) options.headers['Origin'] = fetchHeaders.origin;
        options.credentials = 'include';
        
        fetch(message.url, options)
            .then(res => {
                if (!res.ok) throw new Error("HTTP error " + res.status);
                return res.text();
            })
            .then(text => sendResponse({ text: text }))
            .catch(e => sendResponse({ error: e.message }));
        return true;
    }

    if (message.action === 'wmdStorageBridge') {
        const storageLocal = (chrome && chrome.storage && chrome.storage.local) || (browser && browser.storage && browser.storage.local);
        if (!storageLocal) {
            sendResponse({ success: false, data: {} });
            return;
        }
        if (message.method === 'get') {
            storageLocal.get(message.keys).then(data => sendResponse({ success: true, data })).catch(() => sendResponse({ success: false, data: {} }));
            return true;
        }
        if (message.method === 'set') {
            storageLocal.set(message.items).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
            return true;
        }
        if (message.method === 'remove') {
            storageLocal.remove(message.keys).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
            return true;
        }
    }

    if (message.action === 'downloadOffscreenBlob') {
        const downloadsApi = (chrome && chrome.downloads) || (browser && browser.downloads);
        if (downloadsApi && downloadsApi.download) {
            downloadsApi.download({ url: message.url, filename: message.filename, saveAs: false }, (id) => {
                const err = chrome.runtime.lastError;
                if (err) sendResponse({ success: false, error: err.message });
                else sendResponse({ success: true, downloadId: id });
            });
            return true;
        }
        sendResponse({ success: false, error: 'Downloads API not available' });
        return;
    }

    if (message.action === 'startFetchDownload') {
        handleFetchDownload(message.url, message.filename, message.request, message.downloadId, false, false, null, message.mediaType);
        return;
    }

    if (message.action === 'startDownloadAll') {
        const downloadId = 'zip_' + Date.now();
        handleDownloadAllAsZip(message.items, downloadId);
        sendResponse({ downloadId });
        return;
    }

    if (message.action === 'cancelDownload') {
        let targetId = null;
        if (message.id && activeDownloads.has(message.id)) {
            targetId = message.id;
        } else if (message.id && activeDownloads.has(Number(message.id))) {
            targetId = Number(message.id);
        }
        let isNative = false;

        if (!targetId) {
            for (let [id, val] of activeDownloads) {
                const cocokUrl = message.url && val.url === message.url;
                const cocokId = message.id && String(id) === String(message.id);
                if (cocokUrl || cocokId) {
                    targetId = id;
                    isNative = !!val.isNative;
                    break;
                }
            }
        }

        if (targetId) {
            const item = activeDownloads.get(targetId);
            if (item) {
                if (item.isZip) cancelledZipDownloads.add(targetId);
                if (!item.isAudioJob) {
                    broadcastAudioJob({ action: 'audioJobUpdate', jobId: targetId, filename: item.filename, text: 'Cancelled', percent: item.percent, loaded: item.loaded, total: item.total, complete: true, success: false });
                    browser.runtime.sendMessage({ action: 'downloadError', id: targetId, url: item.url, error: 'USER_CANCELED' }).catch(() => {});
                }
                if (isNative || item.isNative) {
                    browser.downloads.cancel(targetId).catch(() => {});
                } else if (item.abortController) {
                    item.abortController.abort();
                }

                if (item.cloudController) {
                    item.cloudController.cancel();
                }

                activeDownloads.delete(targetId);
                removeDownloadState(targetId);
                cleanupDownload(targetId);
            }
        }
        return;
    }

    if (message.action === 'pauseDownload') {
        let id = activeDownloads.has(message.id) ? message.id : (activeDownloads.has(Number(message.id)) ? Number(message.id) : message.id);
        if (!activeDownloads.has(id) && message.id) {
          for (const [k, v] of activeDownloads) {
            if (v.url === message.id || v.id === message.id) { id = k; break; }
          }
        }
        const item = activeDownloads.get(id);
        if (item) {
            if (item.isStreamJob || item.isAudioJob || item.isZip) {
                item.isPaused = true;
                updateActiveDownloadsBadge().catch(() => {});
                if (item.isAudioJob || item.isStreamJob || item.isPersistentZipJob) {
                    setPersistentJobPaused(item, id, true).catch(console.error);
                    const action = item.isAudioJob ? "pausePersistentAudioJob" :
                        item.isPersistentZipJob ? "pausePersistentZipJob" : "pausePersistentStreamJob";
                    browser.runtime.sendMessage({ action, jobId: id }).catch(console.error);
                }
                browser.runtime.sendMessage({ action: "downloadPaused", id, loaded: item.loaded || 0, total: item.total || 0 }).catch(() => {});
                activeDownloads.set(id, item);
                return true;
            }
            item.recoveryState = "paused";
            if (item.abortController) {
                item.isPaused = true;
                updateActiveDownloadsBadge().catch(() => {});
                item.abortController.abort();
            }
            if (item.cloudController) {
                item.isPaused = true;
                updateActiveDownloadsBadge().catch(() => {});
                item.cloudController.pause();
                

                browser.runtime.sendMessage({
                    action: item.isZip ? 'zipProgress' : 'downloadProgress',
                    id: id,
                    loaded: parseInt(item.loaded) || 0,
                    total: parseInt(item.total) || 0,
                    status: 'uploading',
                    isPaused: true,
                    percent: item.percent
                }).catch(() => {});
            }

            saveDownloadState(id, item).catch(() => {});

            browser.runtime.sendMessage({
                action: 'downloadPaused',
                id: id,
                loaded: parseInt(item.loaded) || 0,
                total: parseInt(item.total) || 0
            }).catch(() => {});
        }
        return;
    }

    if (message.action === 'resumeActiveDownload') {
        let id = activeDownloads.has(message.id) ? message.id : (activeDownloads.has(Number(message.id)) ? Number(message.id) : message.id);
        if (!activeDownloads.has(id) && message.id) {
          for (const [k, v] of activeDownloads) {
            if (v.url === message.id || v.id === message.id) { id = k; break; }
          }
        }
        const item = activeDownloads.get(id);
        if (item && item.isPaused) {
            if (item.isStreamJob || item.isAudioJob || item.isZip) {
                item.isPaused = false;
                updateActiveDownloadsBadge().catch(() => {});
                if (item.isAudioJob || item.isStreamJob || item.isPersistentZipJob) {
                    setPersistentJobPaused(item, id, false).catch(console.error);
                    const action = item.isAudioJob ? "resumePersistentAudioJob" :
                        item.isPersistentZipJob ? "resumePersistentZipJob" : "resumePersistentStreamJob";
                    browser.runtime.sendMessage({ action, jobId: id }).catch(console.error);
                }
                activeDownloads.set(id, item);
                sendResponse?.({ success: true });
                return true;
            }
            item.isPaused = false;
            updateActiveDownloadsBadge().catch(() => {});
            item.recoveryState = "running";

            item.isManualResume = true;
            if (item.cloudController) {
                item.cloudController.resume();
                browser.runtime.sendMessage({
                    action: item.isZip ? 'zipProgress' : 'downloadProgress',
                    id: id,
                    loaded: parseInt(item.loaded) || 0,
                    total: parseInt(item.total) || 0,
                    status: 'uploading',
                    isPaused: false,
                    percent: item.percent
                }).catch(() => {});
            } else {
                handleFetchDownload(item.url, item.filename, item.originalRequest, id, true, true, item.loaded, item.mediaType);
            }
        }
        return;
    }

    if (message.action === 'getActiveDownloads') {
        const downloadsObj = {};
        for (let [id, value] of activeDownloads) {
            downloadsObj[id] = {
                id: id,
                loaded: parseInt(value.loaded) || 0,
                total: parseInt(value.total) || 0,
                url: value.url,
                filename: value.filename,
                isParallel: !!value.isParallel,
                isPaused: !!value.isPaused,
                mediaType: value.mediaType || getMediaType(value.url, []),
                percent: value.percent,
                status: value.status,
                statusText: value.statusText,
                currentFile: value.currentFile,
                isAudioJob: !!value.isAudioJob,
                isStreamJob: !!value.isStreamJob,
                isZip: !!value.isZip,
                isPersistentZipJob: !!value.isPersistentZipJob,
                groupType: value.groupType || null,
                finishedParts: value.finishedParts,
                totalParts: value.totalParts
            };
        }
        sendResponse(downloadsObj);
        return;
    }

    if (message.action === 'downloadComplete' || message.action === 'downloadError') {
        const id = message.id || message.url;
        if (id) {
            activeDownloads.delete(id);
            removeDownloadState(id);
            
            if (message.action === 'downloadComplete') {
                if (message.url) {
                    removeMediaRequest(message.url);
                } else if (id && id.startsWith('http')) {
                    removeMediaRequest(id);
                }
            }

            if (message.cloud || message.background) {
                cleanupDownload(id);
            }
        }
        return;
    }

    if (message.action === 'registerDownloadTab') {
        if (sender.tab && message.id) {
            if (!downloadTabs.has(sender.tab.id)) {
                downloadTabs.set(sender.tab.id, new Set());
            }
            downloadTabs.get(sender.tab.id).add(message.id);
        }
        return;
    }

    if (message.action === 'registerDownloadManagerTab') {
        if (sender.tab) {
            activeBridgeTabId = sender.tab.id;
        }
        return;
    }

    if (message.action === 'confirmZipSkipResponse') {
        if (zipConfirmResolver) {
            zipConfirmResolver(message.result);
            zipConfirmResolver = null;
        }
        return;
    }
});

let zipConfirmResolver = null;

