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

async function askUserToContinue(filename, error) {
    return new Promise((resolve) => {
        zipConfirmResolver = resolve;
        browser.runtime.sendMessage({
            action: 'confirmZipSkip',
            filename: filename,
            error: error
        }).catch(() => {

            if (zipConfirmResolver) {
                zipConfirmResolver(false);
                zipConfirmResolver = null;
            }
        });

        setTimeout(() => {
            if (zipConfirmResolver === resolve) {
                resolve(false);
                zipConfirmResolver = null;
            }
        }, 30000);
    });
}

async function handleDownloadAllAsZip(items, downloadId) {
    await ensureClientZipLoaded();
    try {
        activeDownloads.set(downloadId, { loaded: 0, total: items.length, url: 'zip://' + downloadId, isZip: true });

        const zipEntriesGenerator = async function* () {
            let skipAllErrors = false;
            const usedNames = new Set();
            for (let i = 0; i < items.length; i++) {
                while (activeDownloads.get(downloadId)?.isPaused) {
                    if (cancelledZipDownloads.has(downloadId)) throw new Error("Cancelled");
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                if (cancelledZipDownloads.has(downloadId)) throw new Error("Cancelled");
                const item = items[i];
                const url = item.url;
                const originalRequest = item.originalRequest || item.request;
                const originalFileName = item.filename || "file";
                let filename = originalFileName;

                browser.runtime.sendMessage({
                    action: 'zipProgress',
                    id: downloadId,
                    loaded: i,
                    total: items.length,
                    status: 'downloading',
                    currentFile: filename
                }).catch(() => {});

                try {
                    if (/\.(m3u8|mpd)(?:$|[?#])/i.test(url)) {
                        const processedFiles = await processStreamItemForZip({
                            ...item, request: originalRequest, filename
                        }, downloadId);
                        if (cancelledZipDownloads.has(downloadId)) throw new Error("Cancelled");
                        for (const file of processedFiles) {
                            const resolvedName = file.filename || filename;
                            let entryName = resolvedName;
                            let entryCounter = 1;
                            while (usedNames.has(entryName)) {
                                const parts = resolvedName.split('.');
                                const ext = parts.length > 1 ? '.' + parts.pop() : '';
                                entryName = `${parts.join('.')}_${entryCounter}${ext}`;
                                entryCounter++;
                            }
                            usedNames.add(entryName);
                            yield { name: entryName, input: new Blob([file.arrayBuffer], { type: file.mime || 'application/octet-stream' }) };
                        }
                        activeDownloads.get(downloadId).loaded = i + 1;
                        continue;
                    }
                    const fetchOptions = {
                        method: originalRequest ? originalRequest.method : 'GET',
                        headers: {},
                        credentials: 'include'
                    };

                    if (originalRequest && originalRequest.requestHeaders) {
                        originalRequest.requestHeaders.forEach(h => {
                            const name = h.name.toLowerCase();
                            if (!['cookie', 'referer', 'range', 'content-length'].includes(name)) {
                                fetchOptions.headers[h.name] = h.value;
                            }
                        });
                    }

                    const storedHeaders = golekHeaderTersimpen(url, true);
                    if (storedHeaders) {
                        if (storedHeaders.cookie) fetchOptions.headers['Cookie'] = storedHeaders.cookie;
                        if (storedHeaders.referer) {
                            fetchOptions.headers['Referer'] = storedHeaders.referer;
                            fetchOptions.referrer = storedHeaders.referer;
                        }
                        if (storedHeaders.origin) fetchOptions.headers['Origin'] = storedHeaders.origin;
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

                    const response = await fetch(url, fetchOptions);
                    if (!response.ok) {
                        console.warn(`Failed to download ${url} for ZIP. Status: ${response.status}`);
                        if (skipAllErrors) continue;
                        const zipSkipSetting = await browser.storage.local.get('skip-http-errors');
                        if (zipSkipSetting['skip-http-errors'] === '1' && (response.status === 403 || response.status === 404)) continue;

                        const result = await askUserToContinue(filename, `Server returned ${response.status}`);
                        if (result === 'continue-all') {
                            skipAllErrors = true;
                            continue;
                        }
                        if (result === 'continue') continue;
                        else throw new Error("Cancelled by user after error");
                    }

                    const mimeType = response.headers.get('Content-Type') || '';
                    const resolvedFileName = ensureFileExtension(originalFileName, mimeType);

                    filename = resolvedFileName;
                    let counter = 1;
                    while (usedNames.has(filename)) {
                        const parts = resolvedFileName.split('.');
                        if (parts.length > 1) {
                            const ext = parts.pop();
                            filename = `${parts.join('.')}_${counter}.${ext}`;
                        } else {
                            filename = `${resolvedFileName}_${counter}`;
                        }
                        counter++;
                    }
                    usedNames.add(filename);

                    const reader = response.body.getReader();
                    const pauseAwareBody = new ReadableStream({
                        async pull(controller) {
                            while (activeDownloads.get(downloadId)?.isPaused) {
                                if (cancelledZipDownloads.has(downloadId)) { controller.error(new Error("Cancelled")); return; }
                                await new Promise(resolve => setTimeout(resolve, 200));
                            }
                            const { done, value } = await reader.read();
                            if (done) controller.close(); else controller.enqueue(value);
                        },
                        cancel(reason) { return reader.cancel(reason); }
                    });
                    yield { name: filename, input: new Response(pauseAwareBody, { headers: response.headers }) };

                    activeDownloads.get(downloadId).loaded = i + 1;
                } catch (err) {
                    if (cancelledZipDownloads.has(downloadId) || err.message === "Cancelled") throw new Error("Cancelled");
                    if (err.message === "Cancelled by user after error") throw err;
                    console.warn(`Error fetching ${url} for ZIP:`, err);
                    if (skipAllErrors) continue;

                    const result = await askUserToContinue(filename, err.message);
                    if (result === 'continue-all') {
                        skipAllErrors = true;
                        continue;
                    }
                    if (result === 'continue') continue;
                    else throw new Error("Cancelled by user after error");
                }
            }
        };

        browser.runtime.sendMessage({
            action: 'zipProgress',
            id: downloadId,
            loaded: items.length,
            total: items.length,
            status: 'generating'
        }).catch(() => {});

        const zipResponse = downloadZip(zipEntriesGenerator());
        const zipBlob = await zipResponse.blob();

        if (zipBlob.size < 100) {
             throw new Error(browser.i18n.getMessage("zipEmptyError") || "Failed to download any of the selected files or ZIP is empty.");
        }

        const settings = await browser.storage.local.get(['save-to-gdrive', 'gdrive-stream', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token']);
        const gdriveEnabled = settings['save-to-gdrive'] === '1' && settings['gdrive_token'];
        const isGdriveStream = gdriveEnabled && settings['gdrive-stream'] === '1';
        const dropboxEnabled = settings['save-to-dropbox'] === '1' && settings['dropbox_token'];
        const isDropboxStream = dropboxEnabled && settings['dropbox-stream'] === '1';
        const zipName = `downloads_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

        if (isGdriveStream || isDropboxStream) {
            let gdriveSessionUri = null;
            let dropboxSessionId = null;
            let useDropboxStream = isDropboxStream;
            try {
                if (isGdriveStream) gdriveSessionUri = await startGDriveStreamUpload(zipName, null, 'application/zip');
                if (useDropboxStream) dropboxSessionId = await startDropboxStreamUpload(zipName);
                const controller = new CloudUploadController();
                const activeItem = activeDownloads.get(downloadId);
                if (activeItem) activeItem.cloudController = controller;

                browser.runtime.sendMessage({
                    action: 'zipProgress',
                    id: downloadId,
                    loaded: items.length,
                    total: items.length,
                    status: 'uploading',
                    percent: 0
                }).catch(() => {});

                const response = downloadZip(zipEntriesGenerator());
                const reader = response.body.getReader();
                let offset = 0;
                let zipBuffer = [];
                let zipBufferSize = 0;
                const GDRIVE_CHUNK_UNIT = 256 * 1024;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    zipBuffer.push(value);
                    zipBufferSize += value.byteLength;

                    if (zipBufferSize >= GDRIVE_CHUNK_UNIT) {
                        const fullData = new Uint8Array(zipBufferSize);
                        let pos = 0;
                        for (const b of zipBuffer) {
                            fullData.set(b, pos);
                            pos += b.byteLength;
                        }

                        const uploadSize = Math.floor(zipBufferSize / GDRIVE_CHUNK_UNIT) * GDRIVE_CHUNK_UNIT;
                        const dataToUpload = fullData.slice(0, uploadSize);
                        const remainder = fullData.slice(uploadSize);

                        if (gdriveSessionUri) await uploadStreamChunk(gdriveSessionUri, dataToUpload, offset);
                        if (dropboxSessionId) await appendDropboxStream(dropboxSessionId, offset, dataToUpload);
                        offset += uploadSize;

                        zipBuffer = [remainder];
                        zipBufferSize = remainder.byteLength;

                        browser.runtime.sendMessage({
                            action: 'zipProgress',
                            id: downloadId,
                            loaded: offset,
                            status: 'uploading',
                            percent: Math.min(99, Math.round((offset / (zipBlob.size || offset * 1.1)) * 100))
                        }).catch(() => {});
                    }
                }

                if (zipBufferSize > 0) {
                    const finalData = new Uint8Array(zipBufferSize);
                    let pos = 0;
                    for (const b of zipBuffer) {
                        finalData.set(b, pos);
                        pos += b.byteLength;
                    }
                    if (gdriveSessionUri) await uploadStreamChunk(gdriveSessionUri, finalData, offset);
                    if (dropboxSessionId) await appendDropboxStream(dropboxSessionId, offset, finalData);
                    offset += zipBufferSize;
                }

                if (gdriveSessionUri) await uploadStreamChunk(gdriveSessionUri, new Uint8Array(0), offset, offset);
                if (dropboxSessionId) await finishDropboxStream(dropboxSessionId, offset, zipName);
                activeDownloads.delete(downloadId);
                const cloudService = dropboxSessionId ? 'dropbox' : (gdriveSessionUri ? 'gdrive' : true);
                browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName, cloud: cloudService }).catch(() => {});
                return;
            } catch (e) {
                console.error("GDrive ZIP stream upload failed, falling back to local:", e);
            }
        }

        
        if (dropboxEnabled) {
            const controller = new CloudUploadController();
            const activeItem = activeDownloads.get(downloadId);
            if (activeItem) activeItem.cloudController = controller;

            try {
                browser.runtime.sendMessage({
                    action: 'zipProgress',
                    id: downloadId,
                    loaded: items.length,
                    total: items.length,
                    status: 'uploading',
                    percent: 0
                }).catch(() => {});

                await uploadToDropbox(zipBlob, zipName, (percent, loaded, total) => {
                    const item = activeDownloads.get(downloadId);
                    if (item) {
                        item.percent = percent;
                        item.loaded = loaded;
                        item.total = total;
                    }
                    browser.runtime.sendMessage({
                        action: 'zipProgress',
                        id: downloadId,
                        loaded: loaded,
                        total: total,
                        status: 'uploading',
                        percent: percent,
                        isPaused: item ? !!item.isPaused : false
                    }).catch(() => {});
                }, controller);

                activeDownloads.delete(downloadId);
                browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName, cloud: 'dropbox' }).catch(() => {});
                return;
            } catch (error) {
                console.error("Dropbox ZIP upload failed:", error);
            }
        }

        if (gdriveEnabled) {
            const controller = new CloudUploadController();
            const activeItem = activeDownloads.get(downloadId);
            if (activeItem) activeItem.cloudController = controller;

            try {
                browser.runtime.sendMessage({
                    action: 'zipProgress',
                    id: downloadId,
                    loaded: items.length,
                    total: items.length,
                    status: 'uploading',
                    percent: 0
                }).catch(() => {});

                await uploadToGDrive(zipBlob, zipName, (percent, loaded, total) => {
                    const item = activeDownloads.get(downloadId);
                    if (item) {
                        item.percent = percent;
                        item.loaded = loaded;
                        item.total = total;
                    }
                    browser.runtime.sendMessage({
                        action: 'zipProgress',
                        id: downloadId,
                        loaded: loaded,
                        total: total,
                        status: 'uploading',
                        percent: percent,
                        isPaused: item ? !!item.isPaused : false
                    }).catch(() => {});
                }, controller);
                
                activeDownloads.delete(downloadId);
                browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName, cloud: 'gdrive' }).catch(() => {});
                return;
            } catch (error) {
                console.error("GDrive ZIP upload failed, falling back to local download:", error);
            }
        }

        await storeInCache(downloadId, zipBlob, "application/zip");

        pendingSaveQueue.push({ id: downloadId, url: 'zip://' + downloadId, filename: zipName });
        processSaveQueue();

        activeDownloads.delete(downloadId);
        browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName }).catch(() => {});

    } catch (error) {
        console.error("Background ZIP error:", error);
        activeDownloads.delete(downloadId);
        browser.runtime.sendMessage({ action: 'zipError', id: downloadId, error: error.message === 'Cancelled' ? 'USER_CANCELED' : error.message }).catch(() => {});
    } finally {
        cancelledZipDownloads.delete(downloadId);
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
    } catch (e) { return browser.i18n.getMessage("defaultMediaName") || "Media File"; }
}
