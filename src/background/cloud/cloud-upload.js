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


function uploadToDropbox(blob, filename, onProgress, controller, isRetry = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            if (!res.dropbox_token) {
                return reject(new Error("Dropbox token not found. Please login in settings."));
            }
            const token = res.dropbox_token;

            const uploadUrl = 'https://content.dropboxapi.com/2/files/upload';
            const apiArgRaw = JSON.stringify({
                path: "/" + filename.replace(/[/\\?%*:|"<>]/g, '-'),
                mode: "add",
                autorename: true,
                mute: false
            });
            const apiArg = apiArgRaw.replace(/[\u007f-\uffff]/g, function(c) {
                return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
            });

            const xhr = new XMLHttpRequest();
            if (controller) controller.xhr = xhr;
            xhr.open('POST', uploadUrl);
            xhr.setRequestHeader('Authorization', "Bearer " + token);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('Dropbox-API-Arg', apiArg);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && onProgress) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    onProgress(percent, event.loaded, event.total);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200 || xhr.status === 201) {
                    resolve();
                } else if (xhr.status === 401 && !isRetry) {
                    reauthDropbox().then(() => {
                        uploadToDropbox(blob, filename, onProgress, controller, true).then(resolve).catch(reject);
                    }).catch(() => {
                        reject(new Error("Dropbox session expired. Please re-login in settings."));
                    });
                } else {
                    reject(new Error("Dropbox Upload Error: " + xhr.statusText));
                }
            };

            xhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToDropbox(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                }
            };

            xhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToDropbox(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                } else {
                    reject(new Error("Network error during Dropbox upload"));
                }
            };

            xhr.send(blob);

        } catch (error) {
            reject(error);
        }
    });
}

async function uploadFromCacheToDropbox(downloadId, filename) {
    try {
        const blob = await assembleBlobFromCache(downloadId);
        if (!blob) throw new Error("File data not found in cache");

        const controller = new CloudUploadController();
        const activeItem = activeDownloads.get(downloadId);
        if (activeItem) activeItem.cloudController = controller;

        await uploadToDropbox(blob, filename, (percent, loaded, total) => {
            const item = activeDownloads.get(downloadId);
            if (item) {
                item.percent = percent;
                item.loaded = loaded;
                item.total = total;
            }
            browser.runtime.sendMessage({
                action: 'downloadProgress',
                id: downloadId,
                loaded: loaded,
                total: total,
                percent: percent,
                status: 'uploading',
                isPaused: item ? !!item.isPaused : false
            }).catch(() => {});
        }, controller);
        return true;
    } catch (e) {
        console.error("Dropbox upload from cache failed:", e);
        throw e;
    }
}

async function uploadFromCacheToGDrive(downloadId, filename) {
    try {
        const blob = await assembleBlobFromCache(downloadId);
        if (!blob) throw new Error("File data not found in cache");

        const controller = new CloudUploadController();
        const activeItem = activeDownloads.get(downloadId);
        if (activeItem) activeItem.cloudController = controller;

        await uploadToGDrive(blob, filename, (percent, loaded, total) => {
            const item = activeDownloads.get(downloadId);
            if (item) {
                item.percent = percent;
                item.loaded = loaded;
                item.total = total;
            }
            browser.runtime.sendMessage({
                action: 'downloadProgress',
                id: downloadId,
                loaded: loaded,
                total: total,
                percent: percent,
                status: 'uploading',
                isPaused: item ? !!item.isPaused : false
            }).catch(() => {});
        }, controller);
        return true;
    } catch (e) {
        console.error("GDrive upload from cache failed:", e);
        throw e;
    }
}

async function assembleBlobFromCache(downloadId) {
    const db = await getDB();

    const item = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(downloadId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (item && item.data) {
        return item.data;
    }

    const chunks = await new Promise((resolve, reject) => {
        const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
        const store = tx.objectStore(CHUNK_STORE_NAME);
        const range = IDBKeyRange.bound([downloadId, 0], [downloadId, Infinity]);
        const req = store.getAll(range);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (chunks.length === 0) return null;

    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    const blobParts = chunks.map(c => c.data);
    return new Blob(blobParts, { type: item ? item.mime : 'application/octet-stream' });
}
