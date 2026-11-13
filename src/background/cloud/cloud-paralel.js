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

async function handleParallelFetchDownload(url, filename, total, connections, baseOptions, downloadId, providedContentType = null, startOffset = 0, isManualResume = false, providedMediaType = null) {
    total = parseInt(total) || 0;
    startOffset = parseInt(startOffset) || 0;
    connections = parseInt(connections) || 1;

    const existing = activeDownloads.get(downloadId);
    if (existing && existing.isPaused) return;

    if (activeDownloads.has(downloadId)) {
        const existingItem = activeDownloads.get(downloadId);
        if (existingItem.lastUploadPromise) {
            await existingItem.lastUploadPromise.catch(() => {});
        }
    }

    const abortController = new AbortController();
    baseOptions.signal = abortController.signal;

    try {
        const cleanOptions = { ...baseOptions };
        delete cleanOptions.signal;

        const currentItem = activeDownloads.get(downloadId);
        if (currentItem) {
            currentItem.loaded = startOffset;
            currentItem.total = total;
            currentItem.abortController = abortController;
            currentItem.isParallel = true;
            currentItem.isPaused = false;
            updateActiveDownloadsBadge().catch(() => {});
            currentItem.originalRequest = cleanOptions;
            currentItem.chunkIndexMode = 'bytes';
        } else {
            activeDownloads.set(downloadId, {
                loaded: startOffset,
                total: total,
                abortController: abortController,
                url: url,
                filename: filename,
                originalRequest: cleanOptions,
                isParallel: true,
                chunkIndexMode: 'bytes',
                isManualResume: isManualResume,
                isPaused: false,
                mediaType: providedMediaType || getMediaType(url, providedContentType)
            });
        }
        await saveDownloadState(downloadId, activeDownloads.get(downloadId));
        const remainingSize = total - startOffset;
        const partSize = Math.ceil(remainingSize / connections);
        const CHUNK_SIZE = total >= 20 * 1024 * 1024 ? 4 * 1024 * 1024 : (total >= 5 * 1024 * 1024 ? 2 * 1024 * 1024 : 1024 * 1024);
        let totalLoaded = startOffset;
        let lastReportTime = 0;
        let lastStateSaveTime = 0;
        const totalChunks = Math.ceil(total / CHUNK_SIZE);
        let savedChunks = Math.floor(startOffset / CHUNK_SIZE);

        const partPromises = [];

        for (let i = 0; i < connections; i++) {
            const partStart = startOffset + (i * partSize);
            const partEnd = Math.min(startOffset + ((i + 1) * partSize) - 1, total - 1);
            if (partStart >= total) break;

            partPromises.push((async (pIdx, pStart, pEnd) => {
                let currentPos = pStart;
                let NggonKesimpen = pStart;
                let retries = 0;
                const maxRetries = 5;

                while (currentPos <= pEnd) {
                    const itemCheck = activeDownloads.get(downloadId);
                    if (!itemCheck || itemCheck.isPaused) {
                        break;
                    }

                    try {
                        const partOptions = {
                            ...baseOptions,
                            headers: {
                                ...baseOptions.headers,
                                'Range': `bytes=${currentPos}-${pEnd}`
                            }
                        };

                        const response = await fetch(url, partOptions);
                        if (!response.ok && response.status !== 206) {
                            const partSt = response.status;
                            const skipPartSetting = await browser.storage.local.get('skip-http-errors');
                            if (skipPartSetting['skip-http-errors'] === '1' && (partSt === 403 || partSt === 404)) {
                                browser.runtime.sendMessage({ action: 'skipHttpError', url: url, status: partSt }).catch(() => {});
                                abortController.abort();
                                throw new DOMException(`Part ${pIdx} skipped (HTTP ${partSt})`, 'AbortError');
                            }
                            throw new Error(`Part ${pIdx} failed with status ${partSt}`);
                        }

                        const reader = response.body.getReader();
                        let currentBuffer = [];
                        let currentBufferSize = 0;
                        const partWriteQueue = [];
                        const MAX_PART_WRITE_QUEUE = 3;

                        async function flushPartBuffer(forceWait = false) {
                            if (currentBuffer.length > 0) {
                                const blob = new Blob(currentBuffer);
                                const chunkOffset = currentPos - currentBufferSize;
                                currentBuffer = [];
                                currentBufferSize = 0;

                                const awalChunk = chunkOffset;
                                const akhirChunk = chunkOffset + blob.size;
                                const writePromise = storeChunkInCache(downloadId, chunkOffset, blob).then(() => {
                                    savedChunks++;
                                    if (awalChunk === NggonKesimpen) NggonKesimpen = akhirChunk;
                                    const now = Date.now();
                                    if (now - lastStateSaveTime > 1500) {
                                        lastStateSaveTime = now;
                                        saveDownloadState(downloadId, activeDownloads.get(downloadId));
                                    }
                                });
                                partWriteQueue.push(writePromise);
                            }

                            if (forceWait) {
                                if (partWriteQueue.length > 0) {
                                    await Promise.all(partWriteQueue.splice(0));
                                }
                                saveDownloadState(downloadId, activeDownloads.get(downloadId));
                            } else {
                                while (partWriteQueue.length >= MAX_PART_WRITE_QUEUE) {
                                    await partWriteQueue.shift();
                                }
                            }
                        }

                        while (true) {
                            let readResult;
                            try {
                                readResult = await reader.read();
                            } catch (readError) {
                                await flushPartBuffer(true);
                                throw readError;
                            }

                            const { done, value } = readResult;
                            if (done) break;

                            const loopItemCheck = activeDownloads.get(downloadId);
                            if (!loopItemCheck || loopItemCheck.isPaused) {
                                reader.cancel();
                                break;
                            }

                            currentBuffer.push(value);
                            currentBufferSize += value.length;
                            currentPos += value.length;
                            totalLoaded += value.length;

                            const currentItem = activeDownloads.get(downloadId);
                            if (currentItem) {
                                currentItem.loaded = totalLoaded;
                            }

                            const now = Date.now();
                            if (now - lastReportTime > 200) {
                                lastReportTime = now;
                                if (currentItem) {
                                    currentItem.finishedParts = savedChunks;
                                    currentItem.totalParts = totalChunks;
                                }
                                browser.runtime.sendMessage({
                                    action: 'downloadProgress',
                                    id: downloadId,
                                    url: url,
                                    loaded: parseInt(totalLoaded) || 0,
                                    total: parseInt(total) || 0,
                                    isParallel: true,
                                    finishedParts: savedChunks,
                                    totalParts: totalChunks
                                }).catch(() => {});
                                broadcastAudioJob({
                                    action: 'audioJobUpdate',
                                    jobId: downloadId,
                                    filename: filename || getFileName(url),
                                    text: 'Downloading...',
                                    percent: total > 0 ? Math.round((totalLoaded / total) * 100) : undefined,
                                    loaded: parseInt(totalLoaded) || 0,
                                    total: parseInt(total) || 0,
                                    indeterminate: !(total > 0)
                                });
                            }

                            if (currentBufferSize >= CHUNK_SIZE) {
                                await flushPartBuffer(false);
                            }
                        }
                        await flushPartBuffer(true);
                        if (currentPos > pEnd && NggonKesimpen <= pEnd) {
                            throw new Error(`Part ${pIdx} incomplete: stored up to ${NggonKesimpen}, expected ${pEnd + 1}`);
                        }
                        break;
                    } catch (error) {
                        if (error.name === 'AbortError') {
                            throw error;
                        }
                        retries++;
                        console.warn(`Part ${pIdx} failed (attempt ${retries}/${maxRetries}) at position ${currentPos}:`, error);
                        currentPos = NggonKesimpen;

                        const errorItemCheck = activeDownloads.get(downloadId);
                        if (!errorItemCheck || errorItemCheck.isPaused || retries >= maxRetries) {
                            if (!errorItemCheck || retries >= maxRetries) {
                                abortController.abort();
                            }
                            throw error;
                        }

                        const waitTime = Math.min(1000 * Math.pow(2, retries), 8000);
                        await new Promise(r => setTimeout(r, waitTime));
                    }
                }
            })(i, partStart, partEnd));
        }

        await Promise.all(partPromises);

        browser.runtime.sendMessage({
            action: 'downloadProgress',
            id: downloadId,
            url: url,
            loaded: parseInt(total) || 0,
            total: parseInt(total) || 0,
            isParallel: true,
            finishedParts: totalChunks,
            totalParts: totalChunks
        }).catch(() => {});
        broadcastAudioJob({
            action: 'audioJobUpdate',
            jobId: downloadId,
            filename: filename || getFileName(url),
            text: 'Done!',
            percent: 100,
            loaded: parseInt(total) || 0,
            total: parseInt(total) || 0,
            complete: true,
            success: true
        });

        const finalFilename = filename || getFileName(url);
        const contentType = providedContentType || 'application/octet-stream';

        await storeInCache(downloadId, null, contentType);

        const settings = await browser.storage.local.get(['save-to-gdrive', 'gdrive-stream']);
        const isGdriveEnabled = settings['save-to-gdrive'] === '1';

        pendingSaveQueue.push({
            id: downloadId,
            url,
            filename: finalFilename,
            isStreamUploaded: false, // Parallel doesn't support stream upload yet
            cloud: isGdriveEnabled
        });
        processSaveQueue();

    } catch (error) {
        if (error.name === 'AbortError') {
            const item = activeDownloads.get(downloadId);
            if (item && item.abortController !== abortController) return;
            if (item && item.isPaused) return;
            if (item && item.gagalKarenaMacet) {
                const pesanMacet = 'Unduhan macet: server tidak mengirim data (timeout)';
                browser.runtime.sendMessage({ action: 'downloadError', id: downloadId, url: url, error: pesanMacet }).catch(() => {});
                activeDownloads.delete(downloadId);
                cleanupDownload(downloadId);
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
            cleanupDownload(downloadId);
            return;
        }
        console.error("Parallel download error:", error);
        broadcastAudioJob({
            action: 'audioJobUpdate',
            jobId: downloadId,
            filename: filename || getFileName(url),
            text: error.message || 'Failed',
            complete: true,
            success: false
        });
        browser.runtime.sendMessage({
            action: 'downloadError',
            id: downloadId,
            url: url,
            error: error.message
        }).catch(() => {});
        activeDownloads.delete(downloadId);
        cleanupDownload(downloadId);
    }
}
