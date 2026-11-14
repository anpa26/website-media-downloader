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
    if (message.action === 'startPersistentAudioJob') {
        startPersistentAudioJobDirect(message).then(sendResponse);
        return true;
    }
    if (message.action === 'audioJobProgress') {
        const normalized = normalizeAudioJobStatus(message.text, message.percent);
        message.text = normalized.text;
        message.percent = normalized.percent;
        let item = activeDownloads.get(message.jobId);
        if (!item) {
            item = { id: message.jobId, url: message.url, filename: message.filename, loaded: 0, total: 0, percent: 0, status: 'Starting...', mediaType: 'audio', isAudioJob: true };
            activeDownloads.set(message.jobId, item);
        }
        if (item) {
            if (message.text !== undefined) item.status = message.text;
            if (message.percent !== undefined) item.percent = message.percent;
            broadcastAudioJob({ action: 'audioJobUpdate', jobId: message.jobId, filename: item.filename, text: item.status, percent: item.percent, loaded: item.loaded, total: item.total, indeterminate: message.indeterminate });
            browser.runtime.sendMessage({ action: 'audioPopupStatus', id: item.url, jobId: message.jobId, text: formatAudioJobStatus(item), percent: item.percent, indeterminate: message.indeterminate }).catch(() => {});
        }
        return;
    }
    if (message.action === 'audioJobComplete') {
        finalizeProcessingRecovery(`audioJob_${message.jobId}`, message.success ? "completed" : "failed");
        const item = activeDownloads.get(message.jobId);
        broadcastAudioJob({ action: 'audioJobUpdate', jobId: message.jobId, filename: item?.filename, text: message.success ? 'Complete!' : (message.error || 'Failed'), percent: message.success ? 100 : item?.percent, complete: true, success: message.success });
        if (item) browser.runtime.sendMessage({ action: message.success ? 'downloadComplete' : 'downloadError', id: item.url, jobId: message.jobId, url: item.url, error: message.error }).catch(() => {});
        activeDownloads.delete(message.jobId);
        browser.storage.local.remove(`audioJob_${message.jobId}`).catch(() => {});
        return;
    }
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
    if (message.action === 'fetchMediaForAudio') {
        const tabId = sender.tab && sender.tab.id;
        const controller = new AbortController();
        if (message.jobId) {
            const jobItem = activeDownloads.get(message.jobId);
            if (jobItem) jobItem.abortController = controller;
        }
        (async () => {
            try {
                const response = await fetch(message.url, createMediaFetchOptions(message.url, message.request, controller.signal));
                if (!response.ok && response.status !== 206) {
                    const st = response.status;
                    const skipSetting = await browser.storage.local.get('skip-http-errors');
                    if (skipSetting['skip-http-errors'] === '1' && (st === 403 || st === 404)) {
                        browser.runtime.sendMessage({ action: 'skipHttpError', url: message.url, status: st }).catch(() => {});
                        return sendResponse({ error: 'SKIPPED_HTTP_ERROR' });
                    }
                    throw new Error(browser.i18n.getMessage("serverErrorStatus", [st.toString()]) || (`Server error: ${st}`));
                }

                const total = Number(response.headers.get('content-length')) || 0;
                const mime = response.headers.get('content-type') || 'application/octet-stream';
                const reader = response.body.getReader();
                const chunks = [];
                let loaded = 0;
                while (true) {
                    while (message.jobId && activeDownloads.get(message.jobId)?.isPaused) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.byteLength;
                    if (message.jobId) {
                        const item = activeDownloads.get(message.jobId);
                        const percent = total > 0 ? Math.round((loaded / total) * 100) : undefined;
                        if (item) { item.loaded = loaded; item.total = total; item.percent = percent; item.status = 'Downloading...'; }
                        broadcastAudioJob({ action: 'audioJobUpdate', jobId: message.jobId, filename: item?.filename, text: item?.status, percent, loaded, total, indeterminate: total === 0 });
                        if (item) browser.runtime.sendMessage({ action: 'audioPopupStatus', id: item.url, jobId: message.jobId, text: formatAudioJobStatus(item), percent, indeterminate: total === 0 }).catch(() => {});
                    } else if (tabId !== undefined) {
                        browser.tabs.sendMessage(tabId, {
                            action: 'audioFetchProgress',
                            url: message.url,
                            loaded,
                            total
                        }).catch(() => {});
                    }
                }

                const bytes = new Uint8Array(loaded);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.byteLength;
                }
                sendResponse({ success: true, arrayBuffer: bytes.buffer, mime });
            } catch (error) {
                sendResponse({ success: false, error: error?.message || String(error) });
            }
        })();
        return true;
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
        const downloadId = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        storeInCache(downloadId, blob, message.mime).then(async () => {
            const item = { url: downloadId, filename: message.filename,
                loaded: blob.size, total: blob.size, isCachedSave: true, mediaType: 'file' };
            await saveDownloadState(downloadId, item);
            activeDownloads.set(downloadId, item);
            pendingSaveQueue.push({
                id: downloadId,
                url: downloadId,
                filename: message.filename
            });
            processSaveQueue();
            sendResponse({ success: true });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }
    if (message.action === 'extract' && message.videoId) {
        browser.storage.local.get('youtube-detection').then(result => {
            if (!isFlagEnabled(result['youtube-detection'], true)) {
                sendResponse({ success: false, disabled: true, error: 'YouTube detection is disabled' });
                return;
            }
            const extractor = getYoutubeExtractor();
            if (extractor) {
                extractor.extractAllStreams(message.videoId)
                    .then(data => sendResponse({ success: true, data }))
                    .catch(err => sendResponse({ success: false, error: err.message }));
            } else {
                sendResponse({ success: false, error: 'YoutubeMultiTrack library not loaded' });
            }
        });
        return true; // Keep message channel open for async response
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
                const isFirefox = typeof browser.runtime.getBrowserInfo === 'function' || !browser.offscreen;
                const notificationOptions = {
                    type: "basic",
                    iconUrl: browser.runtime.getURL("icons/icon.png"),
                    title: drmTitle,
                    message: drmMsg
                };
                if (!isFirefox) {
                    notificationOptions.buttons = [];
                }
                browser.notifications.create(notificationOptions);
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
    if (message.action === 'downloadYoutubeVideo' || message.action === 'downloadYoutubeAudio') {
        (async () => {
            const isAudioOnly = message.action === 'downloadYoutubeAudio';
            const mediaUrl = isAudioOnly ? message.audioUrl : message.videoUrl;
            const pageUrl = sender.tab?.url || '';
            const pageTitle = sender.tab?.title || '';
            const storedItems = await browser.storage.session.get(null);
            let request = null;
            for (const value of Object.values(storedItems)) {
                const candidate = Array.isArray(value) ? value[0] : null;
                if (!candidate) continue;
                if (candidate.url === mediaUrl || candidate.ytFormats?.some(format => format.videoUrl === mediaUrl || format.audioUrl === mediaUrl)) {
                    request = candidate;
                    break;
                }
            }
            const settings = await browser.storage.local.get(['download-method', 'audio-to-mp3']);
            let finalName = message.filename;
            if (isAudioOnly) {
                const encodeMp3 = settings['audio-to-mp3'] === '1';
                const audioExt = encodeMp3 ? '.mp3' : (/webm/i.test(decodeURIComponent(mediaUrl)) ? '.webm' : '.m4a');
                finalName = mediaFilename.changeExtension(finalName, audioExt);
                await addToHistory({ url: mediaUrl, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle, mediaType: 'audio' });
                const result = await startPersistentAudioJobDirect({
                    url: mediaUrl, filename: finalName, isYouTube: true, audioOnly: true,
                    directAudioSource: !encodeMp3, encodeM4aToMp3: encodeMp3,
                    request: request || {}, downloadMethod: settings['download-method'] || 'fetch'
                });
                if (!result.success) throw new Error(result.error || 'Unable to start YouTube audio download');
            } else {
                const ext = '.' + (message.demuxer || 'mp4');
                finalName = mediaFilename.changeExtension(finalName, ext);
                await addToHistory({ url: mediaUrl, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle, mediaType: 'video' });
                const result = await startPersistentAudioJobDirect({
                    url: mediaUrl, audioUrl: message.audioUrl || null,
                    filename: finalName, isYouTube: true, audioOnly: false,
                    request: request || {}, downloadMethod: settings['download-method'] || 'fetch'
                });
                if (!result.success) throw new Error(result.error || 'Unable to start YouTube video download');
            }
            sendResponse({ success: true });
        })().catch(error => {
            console.error('Toast YouTube download failed:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
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
    if (message.msg && message.msg.name === 'on_media') {
        try {
            let media = message.msg.data.media;


            function deserializeSerde(obj) {
                if (obj === null || obj === undefined) return obj;
                if (typeof obj !== 'object') return obj;
                if (obj.__serde_tag) {
                    switch (obj.__serde_tag) {
                        case 'primitive': return obj.__serde_val;
                        case 'object': {
                            let result = {};
                            for (let [k, v] of Object.entries(obj.__serde_val || {})) {
                                result[k] = deserializeSerde(v);
                            }
                            return result;
                        }
                        case 'array': return (obj.__serde_val || []).map(deserializeSerde);
                        case 'some': return deserializeSerde(obj.__serde_val);
                        case 'none': return null;
                        case 'url': return obj.__serde_val;
                        case 'map': return new Map((obj.__serde_val || []).map(([k, v]) => [deserializeSerde(k), deserializeSerde(v)]));
                        case 'headers': return obj.__serde_val;
                        case 'ok': return deserializeSerde(obj.__serde_val);
                        case 'err': return null;
                        default: return obj.__serde_val;
                    }
                }

                if (Array.isArray(obj)) return obj.map(deserializeSerde);
                let result = {};
                for (let [k, v] of Object.entries(obj)) {
                    result[k] = deserializeSerde(v);
                }
                return result;
            }


            if (media && media.__serde_tag) {
                media = deserializeSerde(media);
            }

            let pageTitle = media.title;
            let pageUrl = media.initiator || (sender.tab ? sender.tab.url : "");
            let urls = [];
            let ytFormats = [];


            if (media.type === 'youtube_format' && Array.isArray(media.playlist)) {
                for (let entry of media.playlist) {
                    if (!entry || !entry.av || !entry.av.video) continue;
                    let videoUrl = typeof entry.av.video === 'object' ? entry.av.video.url : entry.av.video;
                    let audioUrl = entry.av.audio ? (typeof entry.av.audio === 'object' ? entry.av.audio.url : entry.av.audio) : null;
                    if (!videoUrl) continue;

                    let width = 0, height = 0, bitrate = 0, contentLength = 0;
                    if (entry.quality) {
                        if (entry.quality.size) {
                            width = entry.quality.size.width || 0;
                            height = entry.quality.size.height || 0;
                        }
                        bitrate = entry.quality.bitrate || 0;
                    }
                    if (entry.av.video.content_length) contentLength = entry.av.video.content_length;

                    let label = '';
                    if (height > 0) {
                        if (height >= 2160) label = '4K';
                        else if (height >= 1440) label = '1440p';
                        else label = height + 'p';
                    }


                    let ext = 'mp4';
                    if (entry.mime_type && entry.mime_type.includes('webm')) ext = 'webm';
                    
                    let taggedVideoUrl = videoUrl;
                    if (!taggedVideoUrl.includes('.mp4') && !taggedVideoUrl.includes('.webm') && !taggedVideoUrl.includes('.m3u8') && !taggedVideoUrl.includes('.m4a') && !taggedVideoUrl.includes('.mp3')) {
                        if (taggedVideoUrl.includes('mime=audio')) {
                            taggedVideoUrl += '#audio.' + (ext === 'webm' ? 'webm' : 'm4a');
                        } else {
                            taggedVideoUrl += '#video.' + ext;
                        }
                    }

                    let codec = 'unknown';
                    if (entry.mime_type) {
                        let match = entry.mime_type.match(/codecs="([^"]+)"/);
                        if (match) {
                            let rawCodec = match[1].split('.')[0].toUpperCase();
                            if (rawCodec.startsWith('VP09') || rawCodec.startsWith('VP9')) codec = 'VP9';
                            else if (rawCodec.startsWith('AVC')) codec = 'H264';
                            else if (rawCodec.startsWith('HEVC') || rawCodec.startsWith('HVC')) codec = 'H265';
                            else if (rawCodec.startsWith('AV01')) codec = 'AV1';
                            else codec = rawCodec;
                        }
                    }

                    let taggedAudioUrl = audioUrl;
                    if (taggedAudioUrl && !taggedAudioUrl.includes('.m4a') && !taggedAudioUrl.includes('.webm') && !taggedAudioUrl.includes('.mp3')) {
                        if (taggedAudioUrl.includes('mime=audio%2Fwebm') || taggedAudioUrl.includes('mime=audio/webm')) {
                            taggedAudioUrl += '#audio.webm';
                        } else {
                            taggedAudioUrl += '#audio.m4a';
                        }
                    }

                    ytFormats.push({
                        videoUrl: taggedVideoUrl,
                        audioUrl: taggedAudioUrl,
                        width: width,
                        height: height,
                        bitrate: bitrate,
                        contentLength: contentLength,
                        demuxer: entry.demuxer || 'mp4',
                        codec: codec,
                        label: label,
                        hasAudio: !!entry.av.audio,
                        audioTrack: entry.av.audio && entry.av.audio.audio_track ? entry.av.audio.audio_track : null
                    });

                    if (!urls.includes(taggedVideoUrl)) urls.push(taggedVideoUrl);
                }
            }


            if (urls.length === 0) {
                function extractUrls(obj) {
                    let results = [];
                    if (typeof obj === 'string') {
                        if (obj.includes('googlevideo.com/videoplayback') || obj.endsWith('.mp4') || obj.endsWith('.m3u8') || obj.endsWith('.m4a')) {
                            results.push(obj);
                        }
                    } else if (Array.isArray(obj)) {
                        for (let item of obj) {
                            results = results.concat(extractUrls(item));
                        }
                    } else if (obj !== null && typeof obj === 'object') {
                        for (let key in obj) {
                            results = results.concat(extractUrls(obj[key]));
                        }
                    }
                    return results;
                }
                
                let rawUrls = extractUrls(media);
                for (let mUrl of rawUrls) {
                    if (!mUrl.includes('.mp4') && !mUrl.includes('.webm') && !mUrl.includes('.m3u8') && !mUrl.includes('.m4a') && !mUrl.includes('.mp3')) {
                        let ext = 'mp4';
                        if (mUrl.includes('webm')) ext = 'webm';
                        if (mUrl.includes('mime=audio')) {
                            mUrl += '#audio.' + (ext === 'webm' ? 'webm' : 'm4a');
                        } else {
                            mUrl += '#video.' + ext;
                        }
                    }
                    if (!urls.includes(mUrl)) urls.push(mUrl);
                }
            }

            if (urls.length > 0) {

                if (ytFormats.length > 0) {
                    ytFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
                }
                message = {
                    action: 'reportDetectedMedia',
                    urls: urls,
                    pageTitle: pageTitle,
                    pageUrl: pageUrl,
                    is_youtube: true,
                    ytFormats: ytFormats.length > 0 ? ytFormats : undefined
                };
            } else {
                return;
            }
        } catch (err) {}
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
            let { urls, pageTitle, pageUrl, is_youtube, ytFormats, ytSubtitles, imageDimensions, imageSizes, isManualScan } = message;
            if (!urls || !Array.isArray(urls)) return;
            const exclusionContext = {
                pageTitle: pageTitle || sender.tab?.title,
                pageUrl: pageUrl || sender.tab?.url,
                tabId: sender.tab?.id
            };
            if (await detectionExclusions.shouldSkip(exclusionContext)) return;
            urls = urls.filter(url => !detectionExclusions.matchesDetection({ ...exclusionContext, url }));
            if (!urls.length) return;
            if (Array.isArray(ytFormats)) {
                ytFormats = ytFormats.filter(format =>
                    !detectionExclusions.matchesDetection({ ...exclusionContext, url: format.videoUrl }) &&
                    !detectionExclusions.matchesDetection({ ...exclusionContext, url: format.audioUrl }));
                if (!ytFormats.length) ytFormats = undefined;
            }
            if (settings.ignoreDisabledTypes) {
                urls = urls.filter(u => {
                    const mType = getMediaType(u);
                    return !isMediaTypeDisabled(mType, settings);
                });
            }
            const isYtPage = (pageUrl && pageUrl.includes('youtube.com')) || (sender.tab?.url && sender.tab.url.includes('youtube.com'));
            if ((is_youtube || isYtPage) && !settings.youtubeDetection) return;

            let senderReferer = pageUrl || sender.tab?.url || "";
            if (is_youtube || urls.some(u => u.includes('googlevideo.com'))) {
                senderReferer = "";
            }
            
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


                if (ytFormats && ytFormats.length > 0) {

                    let videoFormats = ytFormats.filter(f => f.height > 0);
                    if (isMediaTypeDisabled('video', settings)) videoFormats = [];
                    let audioOnlyUrls = urls.filter(u => u.includes('mime=audio') || u.includes('#audio'));
                    if (isMediaTypeDisabled('audio', settings)) audioOnlyUrls = [];


                    if (videoFormats.length > 0) {
                        const bestFormat = videoFormats[0]; // Already sorted by height desc
                        const representativeUrl = bestFormat.videoUrl;

                        let mergedFormats = [...videoFormats];
                        let existingSubtitles = ytSubtitles || null;
                        let prevManualScanned = false;
                        if (items[representativeUrl]) {
                            const existingItem = items[representativeUrl][0];
                            if (existingItem && existingItem.manualScanned) prevManualScanned = true;
                            if (existingItem && existingItem.ytFormats) {
                                const existingFormats = existingItem.ytFormats;
                                existingFormats.forEach(oldFmt => {
                                    const isDuplicate = mergedFormats.some(newFmt => 
                                        oldFmt.videoUrl === newFmt.videoUrl && 
                                        oldFmt.audioUrl === newFmt.audioUrl &&
                                        (oldFmt.audioTrack?.id === newFmt.audioTrack?.id)
                                    );
                                    if (!isDuplicate) {
                                        mergedFormats.push(oldFmt);
                                    }
                                });
                            }
                            if (existingItem && existingItem.ytSubtitles && !existingSubtitles) {
                                existingSubtitles = existingItem.ytSubtitles;
                            }
                        }
                        
                        mergedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

                        updates[representativeUrl] = [{
                            url: representativeUrl,
                            method: 'GET',
                            requestHeaders: senderReferer ? [{name: 'Referer', value: senderReferer}, {name: 'Origin', value: senderOrigin}] : null,
                            responseHeaders: null,
                            requestBody: null,
                            cookie: '',
                            size: bestFormat.contentLength || 'unknown',
                            timeStamp: Date.now(),
                            tabId: tabId,
                            pageTitle: pageTitle || sender.tab?.title || "",
                            pageUrl: pageUrl || sender.tab?.url || "",
                            ytFormats: mergedFormats,
                            ytSubtitles: existingSubtitles,
                            ...((isManualScan || prevManualScanned) ? { manualScanned: true } : {})
                        }];
                        hasNew = true;
                    }


                    if (!is_youtube || videoFormats.length === 0) {
                        audioOnlyUrls.forEach(url => {
                            const mType = getMediaType(url);
                            if (isMediaTypeDisabled(mType, settings)) return;
                            const isDrmMedia = isDrmTab && (mType === 'video' || mType === 'audio' || mType === 'stream');

                            if (!items[url] && !isDrmMedia) {
                                updates[url] = [{
                                    url: url,
                                    method: 'GET',
                                    requestHeaders: senderReferer ? [{name: 'Referer', value: senderReferer}, {name: 'Origin', value: senderOrigin}] : null,
                                    responseHeaders: null,
                                    requestBody: null,
                                    cookie: '',
                                    size: 'unknown',
                                    timeStamp: Date.now(),
                                    tabId: tabId,
                                    pageTitle: pageTitle || sender.tab?.title || "",
                                    pageUrl: pageUrl || sender.tab?.url || "",
                                    ...(isManualScan ? { manualScanned: true } : {})
                                }];
                                hasNew = true;
                            } else if (items[url] && isManualScan && !isDrmMedia) {
                                const existing = Array.isArray(items[url]) ? items[url] : [];
                                existing.forEach(req => { if (req) req.manualScanned = true; });
                                updates[url] = existing;
                            }
                        });
                    }
                } else {

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

                        if (senderReferer && !ambilHeaderTersimpen(url)) {
                            urlToHeaderMap.set(url, {
                                referer: senderReferer,
                                origin: senderOrigin,
                                'user-agent': navigator.userAgent,
                                disimpen: Date.now()
                            });
                            savePersistentHeaders();
                        }

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
                }

                if (Object.keys(updates).length) await browser.storage.session.set(updates);
                if (Object.keys(imageMetadataUpdates).length) {
                    await browser.storage.session.set(imageMetadataUpdates).catch(() => {});
                    if (!settings.manualScan || isManualScan) {
                        browser.runtime.sendMessage({ action: 'imageMetadataUpdated', urls: Object.keys(imageMetadataUpdates) }).catch(() => {});
                    }
                }
                updateActiveDownloadsBadge().catch(() => {});
                if (hasNew) {
                    for (const url in updates) {
                        const req = updates[url][0];
                        const detectedType = getMediaType(url) || (url.includes('mime=audio') || url.includes('#audio') ? 'audio' : 'video');
                        maybeAutoDownloadMedia({ url, tabId: tabId ?? req.tabId, pageUrl: req.pageUrl, pageTitle: req.pageTitle, responseHeaders: [{ name: 'content-type', value: detectedType === 'video' ? 'video/mp4' : (detectedType === 'audio' ? 'audio/mp4' : 'application/octet-stream') }] }, settings, req);
                    }
                    if (is_youtube && Array.isArray(ytFormats)) {
                        const audioUrl = ytFormats.find(format => format.audioUrl)?.audioUrl;
                        const baseRequest = Object.values(updates)[0]?.[0];
                        if (audioUrl && baseRequest) {
                            const audioRequest = { ...baseRequest, ytFormats, autoYoutubeAudioOnly: true };
                            maybeAutoDownloadMedia({
                                url: audioUrl,
                                tabId: tabId ?? baseRequest.tabId,
                                pageUrl: baseRequest.pageUrl,
                                pageTitle: baseRequest.pageTitle,
                                responseHeaders: [{ name: 'content-type', value: 'audio/mp4' }]
                            }, settings, audioRequest);
                        }
                    }

                    if (settings.mediaNotification && (!settings.manualScan || isManualScan)) {
                        for (const url in updates) {
                            const req = updates[url][0];
                            let type = 'video';
                            if (url.includes('mime=audio') || url.includes('#audio')) {
                                type = 'audio';
                            } else {
                                const detectedType = getMediaType(url);
                                if (detectedType) {
                                    type = detectedType;
                                }
                            }

                            const details = {
                                url: url,
                                tabId: tabId || req.tabId,
                                isYtNotification: true,
                                ytFormats: ytFormats,
                                responseHeaders: [
                                    { name: 'content-type', value: type === 'video' ? 'video/mp4' : (type === 'audio' ? 'audio/mp4' : 'application/octet-stream') }
                                ]
                            };
                            showMediaNotification(details, settings);
                        }
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
            if (onlyUrl && !items[onlyUrl]) items = {};
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
        return true;
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
        const storageLocal = (browser && browser.storage && browser.storage.local) || (chrome && chrome.storage && chrome.storage.local);
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
        const downloadsApi = (browser && browser.downloads) || (chrome && chrome.downloads);
        if (downloadsApi && downloadsApi.download) {
            Promise.resolve(downloadsApi.download({ url: message.url, filename: message.filename, saveAs: false }))
                .then(id => sendResponse({ success: true, downloadId: id }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true;
        }
        sendResponse({ success: false, error: 'Downloads API not available' });
        return;
    }

    if (message.action === 'startFetchDownload') {
        const id = message.downloadId || `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const item = { url: message.url, filename: message.filename,
            originalRequest: message.request, mediaType: message.mediaType,
            recoveryJobId: message.recoveryJobId, chunkIndexMode: 'bytes' };
        activeDownloads.set(id, item);
        saveDownloadState(id, item).then(() => {
            if (activeDownloads.get(id) !== item) {
                sendResponse({ success: false, error: 'USER_CANCELED' });
                return;
            }
            handleFetchDownload(message.url, message.filename, message.request, id, false, false, null, message.mediaType);
            sendResponse({ success: true, downloadId: id });
        }, error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.action === 'startDownloadAll') {
        const downloadId = 'zip_' + Date.now();
        try {
            muatZipLatar();
        } catch (error) {
            console.error('Gagal muat modul ZIP latar:', error);
            sendResponse({ success: false, downloadId, error: error.message });
            return true;
        }
        handleDownloadAllAsZip(message.items, downloadId);
        sendResponse({ downloadId });
        return true;
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
                const urlMatch = message.url && (
                    val.url === message.url ||
                    val.audioUrl === message.url ||
                    (val.url && val.url.split('?')[0] === message.url.split('?')[0])
                );
                const idMatch = message.id && (
                    val.id === message.id ||
                    val.recoveryJobId === message.id ||
                    String(id) === String(message.id)
                );
                if (urlMatch || idMatch) {
                    targetId = id;
                    isNative = !!val.isNative;
                    break;
                }
            }
        }

        const targetUrl = message.url;
        const targetMsgId = message.id;
        browser.storage.local.get(null).then(stored => {
            const keysToRemove = [];
            for (const [key, job] of Object.entries(stored || {})) {
                if (!/^(audio|stream|zip|popup)Job_/.test(key) || !job) continue;
                const matches = (targetMsgId && (job.jobId === targetMsgId || key === `popupJob_${targetMsgId}` || key === `streamJob_${targetMsgId}` || key === `audioJob_${targetMsgId}` || key === `zipJob_${targetMsgId}`)) ||
                    (targetUrl && (job.url === targetUrl || job.audioUrl === targetUrl || (job.url && job.url.split('?')[0] === targetUrl.split('?')[0])));
                if (matches) keysToRemove.push(key);
            }
            if (keysToRemove.length > 0) browser.storage.local.remove(keysToRemove).catch(() => {});
        }).catch(() => {});

        if (targetId) {
            const item = activeDownloads.get(targetId);
            if (item) {
                if (item.recoveryKey) browser.storage.local.remove(item.recoveryKey).catch(() => {});
                if (item.isZip) cancelledZipDownloads.add(targetId);
                if (item.isAudioJob) {
                    if (item.abortController) item.abortController.abort();
                    browser.runtime.sendMessage({ action: 'cancelPersistentAudioJob', jobId: targetId, url: item.url, audioUrl: item.audioUrl, youtubeTracks: item.youtubeTracks }).catch(() => {});
                    if (item.processorTabId !== undefined) browser.tabs.remove(item.processorTabId).catch(() => {});
                    browser.storage.local.remove(`audioJob_${targetId}`).catch(() => {});
                    broadcastAudioJob({ action: 'audioJobUpdate', jobId: targetId, filename: item.filename, text: 'Cancelled', percent: item.percent, loaded: item.loaded, total: item.total, complete: true, success: false });
                    browser.runtime.sendMessage({ action: 'downloadError', id: item.url, jobId: targetId, url: item.url, error: 'USER_CANCELED' }).catch(() => {});
                } else {
                    broadcastAudioJob({ action: 'audioJobUpdate', jobId: targetId, filename: item.filename, text: 'Cancelled', percent: item.percent, loaded: item.loaded, total: item.total, complete: true, success: false });
                    browser.runtime.sendMessage({ action: 'downloadError', id: targetId, jobId: targetId, url: item.url, error: 'USER_CANCELED' }).catch(() => {});
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
        return true;
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
                if (item.isZip || item.isPersistentZipJob) {
                    browser.runtime.sendMessage({
                        action: 'zipProgress', id,
                        loaded: item.loaded || 0, total: item.total || 0,
                        status: item.status || 'downloading',
                        currentFile: item.currentFile || '',
                        text: item.statusText || '',
                        percent: item.percent,
                        isPaused: true
                    }).catch(() => {});
                }
                activeDownloads.set(id, item);
                return true;
            }
            if (item.recoveryKey) {
                pauseProcessingJob(id).catch(console.error);
                return true;
            }
            item.recoveryState = "paused";
            if (item.isNative) {
                item.isPaused = true;
                updateActiveDownloadsBadge().catch(() => {});
                browser.downloads.pause(Number(id)).catch(() => {});
            }
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

            if (!item.isAudioJob && !item.isStreamJob && !item.isZip && !item.recoveryKey) {
                saveDownloadState(id, item).catch(() => {});
            }

            browser.runtime.sendMessage({
                action: 'downloadPaused',
                id: id,
                loaded: parseInt(item.loaded) || 0,
                total: parseInt(item.total) || 0
            }).catch(() => {});
        }
        return true;
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
                if (item.isZip || item.isPersistentZipJob) {
                    browser.runtime.sendMessage({
                        action: 'zipProgress', id,
                        loaded: item.loaded || 0, total: item.total || 0,
                        status: item.status || 'downloading',
                        currentFile: item.currentFile || '',
                        text: item.statusText || '',
                        percent: item.percent,
                        isPaused: false
                    }).catch(() => {});
                }
                activeDownloads.set(id, item);
                sendResponse?.({ success: true });
                return true;
            }
            if (item.isNative || item.recoveryKey) {
                resumeSavedDownload(id).then(() => sendResponse({ success: true }), error => sendResponse({ success: false, error: error.message }));
                return true;
            }
            item.isPaused = false;
            updateActiveDownloadsBadge().catch(() => {});

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
        return true;
    }

    if (message.action === 'getActiveDownloads') {
        staleDownloadStateCleanupReady.then(() => {
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
        });
        return true;
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
        return true;
    }
});

let zipConfirmResolver = null;

