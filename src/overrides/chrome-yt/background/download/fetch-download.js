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

async function handleFetchDownload(url, filename, originalRequest = null, providedId = null, isResuming = false, isManualResume = false, providedResumeOffset = null, providedMediaType = null, providedDropboxSessionId = null) {
    providedResumeOffset = parseInt(providedResumeOffset) || 0;
    const settings = await browser.storage.local.get(['speed-boost', 'speed-boost-resume', 'connections', 'save-to-gdrive', 'gdrive-stream', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token', 'fetch-notification']);
    const speedBoostEnabled = settings['speed-boost'] === '1';
    const speedBoostResumeEnabled = settings['speed-boost-resume'] === '1';
    const connections = parseInt(settings['connections'] || '4', 10);
    const gdriveEnabled = settings['save-to-gdrive'] === '1';
    const gdriveStreamEnabled = settings['save-to-gdrive'] === '1' && settings['gdrive-stream'] === '1' && settings['gdrive_token'] && !isResuming;
    const dropboxStreamEnabled = settings['save-to-dropbox'] === '1' && settings['dropbox-stream'] === '1' && settings['dropbox_token']; // Allowed during resume!


    const abortController = new AbortController();
    const downloadId = providedId || ('dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));

    const showNotif = settings['fetch-notification'] !== '0';
    if (showNotif) {
        try {
            browser.notifications.create(downloadId, {
                type: "basic",
                iconUrl: browser.runtime.getURL("icons/icon.png"),
                title: (browser.i18n.getMessage("downloadingTitle") || "Downloading..."),
                message: filename
            });
        } catch (err) {
            console.warn("Notifications API error:", err);
        }
    }

    if (!activeDownloads.has(downloadId)) {
        activeDownloads.set(downloadId, { 
            loaded: providedResumeOffset || 0, 
            total: 0, 
            abortController: abortController, 
            url: url,
            filename: filename,
            isParallel: false,
            isManualResume: isManualResume,
            isPaused: false,
            mediaType: providedMediaType || getMediaType(url, []),
            dropboxSessionId: providedDropboxSessionId
        });
    } else {
        const item = activeDownloads.get(downloadId);
        item.abortController = abortController;
        item.isPaused = false;
        updateActiveDownloadsBadge().catch(() => {});
        if (providedDropboxSessionId) item.dropboxSessionId = providedDropboxSessionId;
    }

    let resumeOffset = providedResumeOffset || 0;
    let isByteOffsetMode = resumeOffset > 10000;
    let nextChunkIndex = isByteOffsetMode ? resumeOffset : Math.floor(resumeOffset / (1024 * 1024));

    if (isResuming) {
        try {
            const db = await getDB();
            const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
            const store = tx.objectStore(CHUNK_STORE_NAME);
            const range = IDBKeyRange.bound([downloadId, 0], [downloadId, Infinity]);
            
            const cursorRequest = store.openCursor(range, "prev");
            const lastChunk = await new Promise((resolve) => {
                cursorRequest.onsuccess = (e) => resolve(e.target.result ? e.target.result.value : null);
                cursorRequest.onerror = () => resolve(null);
            });

            if (lastChunk) {
                const dbIsByteOffsetMode = lastChunk.chunkIndex > 10000; 

                const dbResumeOffset = await new Promise((resolve) => {
                    let sum = 0;
                    const countTx = db.transaction([CHUNK_STORE_NAME], "readonly");
                    const countStore = countTx.objectStore(CHUNK_STORE_NAME);
                    const countReq = countStore.openCursor(range);
                    countReq.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            sum += cursor.value.data.length;
                            cursor.continue();
                        } else resolve(sum);
                    };
                    countReq.onerror = () => resolve(0);
                });


                if (dbResumeOffset > resumeOffset) {
                    resumeOffset = dbResumeOffset;
                    isByteOffsetMode = dbIsByteOffsetMode;
                    if (isByteOffsetMode) {
                        nextChunkIndex = resumeOffset; 
                    } else {
                        nextChunkIndex = lastChunk.chunkIndex + 1;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to calculate resume offset from DB:", e);
        }
    } else {
        isByteOffsetMode = true; 
    }

    try {
        const fetchOptions = {
            method: (originalRequest && originalRequest.method) ? originalRequest.method : 'GET',
            headers: (originalRequest && originalRequest.headers && !Array.isArray(originalRequest.headers)) ? { ...originalRequest.headers } : {},
            credentials: (originalRequest && originalRequest.credentials) ? originalRequest.credentials : 'include',
            signal: abortController.signal
        };

        if (resumeOffset > 0) {
            fetchOptions.headers['Range'] = `bytes=${resumeOffset}-`;
        } else if (speedBoostEnabled && connections > 1 && !gdriveStreamEnabled && !dropboxStreamEnabled) {
            fetchOptions.headers['Range'] = `bytes=0-`;
        }

        if (originalRequest && originalRequest.requestHeaders && Array.isArray(originalRequest.requestHeaders)) {
            originalRequest.requestHeaders.forEach(h => {
                const name = h.name.toLowerCase();

                if (name !== 'cookie' && name !== 'referer' && name !== 'range' && name !== 'host') {
                    fetchOptions.headers[h.name] = h.value;
                }
            });
        }

        const storedHeaders = golekHeaderTersimpen(url, true);
        if (storedHeaders) {
            for (const [name, value] of Object.entries(storedHeaders)) {
                if (name === 'disimpen') continue;
                if (name === 'cookie') {
                    fetchOptions.headers['Cookie'] = value;
                } else if (name === 'referer') {
                    fetchOptions.referrer = value;
                    fetchOptions.headers['Referer'] = value;
                } else if (name !== 'host' && name !== 'content-length') {
                    fetchOptions.headers[name] = value;
                }
            }

            if (storedHeaders.referer && !fetchOptions.headers['Origin']) {
                try {
                    const refUrl = new URL(storedHeaders.referer);
                    if (refUrl.protocol.startsWith('http')) {
                        fetchOptions.headers['Origin'] = refUrl.origin;
                    }
                } catch (e) {}
            }
        }

        const manualReferer = originalRequest?.requestHeaders?.find(h => h.name.toLowerCase() === 'referer')?.value;
        if (manualReferer) {
            fetchOptions.referrer = manualReferer;
            fetchOptions.headers['Referer'] = manualReferer;
            if (!fetchOptions.headers['Origin']) {
                try {
                    const refUrl = new URL(manualReferer);
                    if (refUrl.protocol.startsWith('http')) fetchOptions.headers['Origin'] = refUrl.origin;
                } catch(e) {}
            }
        }

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

        if (activeDownloads.has(downloadId)) {
            const current = activeDownloads.get(downloadId);
            current.abortController = abortController;
            current.isManualResume = isManualResume;
            current.isPaused = false;
            updateActiveDownloadsBadge().catch(() => {});
        }

        const response = await fetch(url, fetchOptions);

        const itemBeforeProceed = activeDownloads.get(downloadId);
        if (itemBeforeProceed && itemBeforeProceed.isPaused) {
            if (response.body && response.body.cancel) response.body.cancel();
            return;
        }

        if (!response.ok && response.status !== 206) {
            const fetchSt = response.status;
            const skipHttpSetting = await browser.storage.local.get('skip-http-errors');
            if (skipHttpSetting['skip-http-errors'] === '1' && (fetchSt === 403 || fetchSt === 404)) {
                browser.runtime.sendMessage({ action: 'skipHttpError', url: url, status: fetchSt }).catch(() => {});
                return;
            }
            throw new Error(browser.i18n.getMessage("serverErrorStatus", [fetchSt.toString()]) || ("Server error: " + fetchSt));
        }

        let currentResumeOffset = resumeOffset;
        let activeChunkIndex = nextChunkIndex;
        let activeByteOffsetMode = isByteOffsetMode;

        if (resumeOffset > 0 && response.status !== 206) {
            console.warn("Server ignored Range header, restarting download from byte 0");
            currentResumeOffset = 0;
            activeChunkIndex = 0;
            activeByteOffsetMode = true; 
        }

        const contentLength = response.headers.get('content-length');
        let total = (contentLength ? parseInt(contentLength, 10) : 0) + currentResumeOffset;

        const contentRange = response.headers.get('content-range');
        if (contentRange) {
            const match = contentRange.match(/\/(\d+)/);
            if (match) {
                total = parseInt(match[1], 10);
            }
        }

        const acceptRanges = response.headers.get('accept-ranges');
        const supportsRanges = acceptRanges === 'bytes' || response.status === 206;
        const contentType = response.headers.get('content-type');

        const canUseSpeedBoost = speedBoostEnabled && supportsRanges && total > 2 * 1024 * 1024 && connections > 1 && !gdriveStreamEnabled && !dropboxStreamEnabled;

        const speedBoostAllowed = isManualResume ? speedBoostResumeEnabled : true;

        if (canUseSpeedBoost && speedBoostAllowed) {
            
            const itemBeforeParallel = activeDownloads.get(downloadId);
            if (itemBeforeParallel && itemBeforeParallel.isPaused) {
                if (response.body && response.body.cancel) response.body.cancel();
                return;
            }

            if (response.body && response.body.cancel) {
                response.body.cancel();
            } else {
                abortController.abort();
            }

            const parallelOptions = { ...fetchOptions };
            delete parallelOptions.signal;

            return handleParallelFetchDownload(url, filename, total, connections, parallelOptions, downloadId, contentType, currentResumeOffset, isManualResume, providedMediaType);
        }

        const cleanOriginalRequest = { ...fetchOptions };
        delete cleanOriginalRequest.signal;

        const existingItem = activeDownloads.get(downloadId);
        if (existingItem) {
            existingItem.loaded = currentResumeOffset;
            existingItem.total = total;
            existingItem.abortController = abortController;
            existingItem.isParallel = false;
            existingItem.isPaused = false;
            updateActiveDownloadsBadge().catch(() => {});
            existingItem.chunkIndex = activeChunkIndex;
        } else {
            activeDownloads.set(downloadId, { 
                loaded: currentResumeOffset, 
                total: total, 
                abortController: abortController, 
                url: url,
                filename: filename,
                originalRequest: cleanOriginalRequest,
                isParallel: false,
                isManualResume: isManualResume,
                isPaused: false,
                chunkIndex: activeChunkIndex,
                mediaType: providedMediaType || getMediaType(url, contentType),
                dropboxSessionId: dropboxSessionId
            });
        }
        await saveDownloadState(downloadId, activeDownloads.get(downloadId));

        let gdriveSessionUri = null;
        let dropboxSessionId = providedDropboxSessionId || null;
        if (dropboxStreamEnabled && !dropboxSessionId) {
            try {
                dropboxSessionId = await startDropboxStreamUpload(filename || getFileName(url));
                if (activeDownloads.has(downloadId)) activeDownloads.get(downloadId).dropboxSessionId = dropboxSessionId;
            } catch (e) {
                console.error("Failed to start Dropbox stream upload:", e);
            }
        }
        if (gdriveStreamEnabled) {
            try {
                gdriveSessionUri = await startGDriveStreamUpload(filename || getFileName(url), total, contentType);
            } catch (e) {
                console.error("Failed to start GDrive stream upload:", e);

            }
        }

        const infoBeforeLoop = activeDownloads.get(downloadId);
        const reader = response.body.getReader();
        let loaded = currentResumeOffset;
        let lastReportTime = 0;

        const writeQueue = [];
        const MAX_WRITE_QUEUE = 10;
        let lastUploadPromise = Promise.resolve();
        if (infoBeforeLoop) infoBeforeLoop.lastUploadPromise = lastUploadPromise;

        let currentBuffer = [];
        let currentBufferSize = 0;
        const GDRIVE_CHUNK_UNIT = 256 * 1024; // GDrive requirement
        const BUFFER_THRESHOLD = 1024 * 1024; // 1MB buffer

        async function flushBuffer(isFinal = false) {
            if (currentBufferSize === 0 && (!isFinal || !gdriveSessionUri)) return;

            let dataToUpload = null;
            let uploadSize = 0;

            const fullData = new Uint8Array(currentBufferSize);
            let pos = 0;
            for (const b of currentBuffer) {
                fullData.set(b, pos);
                pos += b.length;
            }

            if (isFinal || !gdriveSessionUri) {
                dataToUpload = fullData;
                uploadSize = currentBufferSize;
                currentBuffer = [];
                currentBufferSize = 0;
            } else {

                uploadSize = Math.floor(currentBufferSize / GDRIVE_CHUNK_UNIT) * GDRIVE_CHUNK_UNIT;
                if (uploadSize === 0) return; // Not enough data yet

                dataToUpload = fullData.slice(0, uploadSize);
                const remainder = fullData.slice(uploadSize);
                currentBuffer = [remainder];
                currentBufferSize = remainder.length;
            }

            let usedIndex;
            if (activeByteOffsetMode) {
                usedIndex = loaded - (fullData.length - (fullData.length - uploadSize)); // Corrected below

            }
            

            const byteOffset = loaded - currentBufferSize - uploadSize;
            
            if (dataToUpload.length > 0) {
                const writePromise = storeChunkInCache(downloadId, activeByteOffsetMode ? byteOffset : activeChunkIndex++, dataToUpload);
                writeQueue.push(writePromise);
            }

            if (dropboxSessionId && dataToUpload.length > 0) {
                const currentDbxSessionId = dropboxSessionId;
                const chunkData = dataToUpload;
                const currentOffset = byteOffset;
                
                lastUploadPromise = lastUploadPromise.then(async () => {
                    if (!dropboxSessionId) return;
                    
                    let retries = 3;
                    while (retries > 0) {
                        try {
                            await appendDropboxStream(currentDbxSessionId, currentOffset, chunkData);
                            return;
                        } catch (e) {
                            retries--;
                            console.warn(`Dropbox chunk upload retry (${3-retries}):`, e);
                            if (retries === 0) {
                                console.error("Dropbox stream upload failed after retries.");
                                dropboxSessionId = null;
                            } else {
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    }
                });
                writeQueue.push(lastUploadPromise);
                if (activeDownloads.has(downloadId)) activeDownloads.get(downloadId).lastUploadPromise = lastUploadPromise;
            }

            if (gdriveSessionUri && (dataToUpload.length > 0 || isFinal)) {
                const currentSessionUri = gdriveSessionUri;
                const chunkData = dataToUpload;
                const currentOffset = byteOffset;
                const currentTotal = isFinal ? loaded : total;
                
                lastUploadPromise = lastUploadPromise.then(async () => {
                    if (!gdriveSessionUri) return;
                    
                    let retries = 3;
                    while (retries > 0) {
                        try {
                            await uploadStreamChunk(currentSessionUri, chunkData, currentOffset, currentTotal);
                            return;
                        } catch (e) {
                            retries--;
                            console.warn(`GDrive chunk upload retry (${3-retries}):`, e);
                            if (retries === 0) {
                                console.error("GDrive stream upload failed after retries.");
                                gdriveSessionUri = null;
                            } else {
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    }
                });
                writeQueue.push(lastUploadPromise);
                if (activeDownloads.has(downloadId)) activeDownloads.get(downloadId).lastUploadPromise = lastUploadPromise;
            }

            while (writeQueue.length >= MAX_WRITE_QUEUE) {
                await writeQueue.shift();
            }
            saveDownloadState(downloadId, activeDownloads.get(downloadId));
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const currentItem = activeDownloads.get(downloadId);
            if (!currentItem || currentItem.isPaused) {
                reader.cancel();
                break;
            }
            currentItem.loaded = loaded;

            currentBuffer.push(value);
            currentBufferSize += value.length;
            loaded += value.length;

            const now = Date.now();
            if (now - lastReportTime > 100) {
                lastReportTime = now;
                browser.runtime.sendMessage({
                    action: 'downloadProgress',
                    id: downloadId,
                    url: url,
                    loaded: parseInt(loaded) || 0,
                    total: parseInt(total) || 0,
                    isParallel: false,
                    isPaused: false,
                    status: (gdriveSessionUri || dropboxSessionId) ? 'uploading' : 'downloading'
                }).catch(() => {});
                broadcastAudioJob({
                    action: 'audioJobUpdate',
                    jobId: downloadId,
                    filename: filename || getFileName(url),
                    text: (gdriveSessionUri || dropboxSessionId) ? 'Uploading...' : 'Downloading...',
                    percent: total > 0 ? Math.round((loaded / total) * 100) : undefined,
                    loaded: parseInt(loaded) || 0,
                    total: parseInt(total) || 0,
                    indeterminate: !(total > 0)
                });
            }

            if (currentBufferSize >= BUFFER_THRESHOLD) {
                await flushBuffer();
            }
        }


        if (total <= 0) total = loaded;
        
        await flushBuffer(true);

        await Promise.all(writeQueue);


        
        if (dropboxSessionId) {
            try {
                await finishDropboxStream(dropboxSessionId, loaded, filename || getFileName(url));
                const currentItem = activeDownloads.get(downloadId);
                if (currentItem) currentItem.isStreamUploaded = true;
            } catch (e) {
                console.error("Dropbox finish failed", e);
            }
        }
        if (gdriveSessionUri) {
            const currentItem = activeDownloads.get(downloadId);
            if (currentItem) currentItem.isStreamUploaded = true;
        }

        browser.runtime.sendMessage({
            action: 'downloadProgress',
            id: downloadId,
            url: url,
            loaded: parseInt(loaded) || 0,
            total: parseInt(total) || 0,
            isParallel: false,
            percent: 100,
            status: ((gdriveSessionUri || dropboxSessionId) && activeDownloads.get(downloadId)?.isStreamUploaded) ? 'uploading' : 'downloading'
        }).catch(() => {});
        broadcastAudioJob({
            action: 'audioJobUpdate',
            jobId: downloadId,
            filename: filename || getFileName(url),
            text: 'Done!',
            percent: 100,
            loaded: parseInt(loaded) || 0,
            total: parseInt(total) || 0,
            complete: true,
            success: true
        });

        const currentItem = activeDownloads.get(downloadId);
        if (currentItem) {
            currentItem.status = 'complete';
            currentItem.percent = 100;
        }
        updateActiveDownloadsBadge();

        const finalFilename = filename || getFileName(url);
        const contentTypeToStore = contentType || 'application/octet-stream';

        await storeInCache(downloadId, null, contentTypeToStore);

        const currentItemAfterCache = activeDownloads.get(downloadId);
        const gdriveFallBack = (settings['save-to-gdrive'] === '1' && !gdriveStreamEnabled) || (settings['save-to-dropbox'] === '1' && !dropboxStreamEnabled);

        pendingSaveQueue.push({
            id: downloadId,
            url,
            filename: finalFilename,
            isStreamUploaded: currentItemAfterCache ? !!currentItemAfterCache.isStreamUploaded : false,
            cloud: gdriveFallBack
        });
        processSaveQueue();

        if (showNotif) {
            try {
                browser.notifications.clear(downloadId);
                const completeId = downloadId + '_complete';
                browser.notifications.create(completeId, {
                    type: "basic",
                    iconUrl: browser.runtime.getURL("icons/icon.png"),
                    title: browser.i18n.getMessage("downloadCompleteTitle") || "Download completed",
                    message: finalFilename
                });
                setTimeout(() => {
                    try { browser.notifications.clear(completeId); } catch (e) {}
                }, 5000);
            } catch (err) {
                console.warn("Notifications API error:", err);
            }
        }
    } catch (error) {
        if (showNotif) {
            try {
                browser.notifications.clear(downloadId);
                if (error.name !== 'AbortError' && error.message !== 'Cancelled') {
                    browser.notifications.create(downloadId + '_error', {
                        type: "basic",
                        iconUrl: browser.runtime.getURL("icons/icon.png"),
                        title: "Download failed",
                        message: error.message
                    });
                }
            } catch (err) {
                console.warn("Notifications API error:", err);
            }
        }

        if (error.name === 'AbortError') {
            const item = activeDownloads.get(downloadId);
            if (item && item.isPaused) return; 
            if (item && item.gagalKarenaMacet) {
                const pesanMacet = 'Unduhan macet: server tidak mengirim data (timeout)';
                browser.runtime.sendMessage({ action: 'downloadError', id: downloadId, url: url, error: pesanMacet }).catch(() => {});
                activeDownloads.delete(downloadId);
                removeDownloadState(downloadId);
                return;
            }
            
            broadcastAudioJob({
                action: 'audioJobUpdate',
                jobId: downloadId,
                filename: filename || getFileName(url),
                text: 'Cancelled',
                complete: true,
                success: false
            });
            activeDownloads.delete(downloadId);
            browser.runtime.sendMessage({ action: 'downloadError', id: downloadId, url: url, error: 'USER_CANCELED' }).catch(() => {});
            removeDownloadState(downloadId);
            return;
        }

        console.error("Background fetch download failed:", error);
        broadcastAudioJob({
            action: 'audioJobUpdate',
            jobId: downloadId,
            filename: filename || getFileName(url),
            text: error.message || 'Failed',
            complete: true,
            success: false
        });
        browser.runtime.sendMessage({ action: 'downloadError', id: downloadId, url: url, error: error.message }).catch(() => {});

        activeDownloads.delete(downloadId);
        removeDownloadState(downloadId);
    }
}
