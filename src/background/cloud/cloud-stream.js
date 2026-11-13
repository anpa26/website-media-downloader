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

class CloudUploadController {
    constructor() {
        this.paused = false;
        this.cancelled = false;
        this.onResume = null;
        this.xhr = null;
    }

    pause() {
        this.paused = true;
        if (this.xhr) {
            this.xhr.abort();
        }
    }

    resume() {
        this.paused = false;
        if (this.onResume) {
            this.onResume();
        }
    }

    cancel() {
        this.cancelled = true;
        if (this.xhr) {
            this.xhr.abort();
        }
    }
}

function uploadToGDrive(blob, filename, onProgress, controller, isRetry = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('gdrive_token');
            if (!res.gdrive_token) {
                return reject(new Error(browser.i18n.getMessage("gdriveLoginRequired") || "Google Drive token not found. Please login in settings."));
            }
            const token = res.gdrive_token;

            const metadata = {
                name: filename,
                mimeType: blob.type || 'application/octet-stream'
            };

            const initXhr = new XMLHttpRequest();
            if (controller) controller.xhr = initXhr;
            initXhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable');
            initXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            initXhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
            initXhr.setRequestHeader('X-Upload-Content-Type', blob.type || 'application/octet-stream');
            initXhr.setRequestHeader('X-Upload-Content-Length', blob.size);

            initXhr.onload = () => {
                if (initXhr.status === 200 || initXhr.status === 201) {
                    const sessionUri = initXhr.getResponseHeader('Location');
                    if (sessionUri) {
                        uploadChunks(sessionUri, blob, onProgress, controller).then(resolve).catch(reject);
                    } else {
                        reject(new Error("Failed to get session URI for resumable upload"));
                    }
                } else if (initXhr.status === 401) {
                    if (!isRetry) {
                        reauthGDrive().then(() => {
                            uploadToGDrive(blob, filename, onProgress, controller, true).then(resolve).catch(reject);
                        }).catch(() => {
                            reject(new Error("Google Drive session expired. Please re-login in settings."));
                        });
                    } else {
                        reject(new Error("Google Drive session expired. Please re-login in settings."));
                    }
                } else {
                    reject(new Error("GDrive Init Error: " + initXhr.statusText));
                }
            };

            initXhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToGDrive(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                }
            };

            initXhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToGDrive(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                } else {
                    reject(new Error("Network error during GDrive init"));
                }
            };
            initXhr.send(JSON.stringify(metadata));

        } catch (error) {
            reject(error);
        }
    });
}

function uploadChunks(sessionUri, blob, onProgress, controller) {
    return new Promise((resolve, reject) => {
        const chunkSize = 1024 * 1024; // 1MB chunks
        let offset = 0;

        const uploadNextChunk = (retries = 3) => {
            if (controller && controller.cancelled) {
                reject(new Error("Upload cancelled"));
                return;
            }

            if (controller && controller.paused) {
                controller.onResume = () => {
                    controller.onResume = null;
                    uploadNextChunk();
                };
                return;
            }

            const end = Math.min(offset + chunkSize, blob.size);
            const chunk = blob.slice(offset, end);
            const contentRange = `bytes ${offset}-${end - 1}/${blob.size}`;

            const xhr = new XMLHttpRequest();
            if (controller) controller.xhr = xhr;
            xhr.open('PUT', sessionUri);
            xhr.setRequestHeader('Content-Range', contentRange);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    const totalUploaded = offset + e.loaded;
                    const percent = Math.round((totalUploaded / blob.size) * 100);
                    onProgress(percent, totalUploaded, blob.size);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 308) {
                    offset = end;
                    uploadNextChunk();
                } else if (xhr.status === 200 || xhr.status === 201) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        resolve(xhr.responseText);
                    }
                } else if (xhr.status >= 500 && xhr.status < 600) {
                    if (retries > 0) {
                        console.warn(`GDrive Chunk Error: ${xhr.status}, retrying... (${retries} left)`);
                        setTimeout(() => uploadNextChunk(retries - 1), 2000);
                    } else {
                        reject(new Error("GDrive Chunk Error: " + xhr.status + " " + xhr.statusText));
                    }
                } else {
                    reject(new Error("GDrive Chunk Error: " + xhr.status + " " + xhr.statusText));
                }
            };

            xhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadNextChunk();
                    };
                }
            };

            xhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {

                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadNextChunk();
                    };
                } else {
                    if (retries > 0) {
                        console.warn(`Network error during GDrive chunk upload, retrying... (${retries} left)`);
                        setTimeout(() => uploadNextChunk(retries - 1), 2000);
                    } else {
                        reject(new Error("Network error during GDrive chunk upload"));
                    }
                }
            };
            xhr.send(chunk);
        };

        uploadNextChunk();
    });
}

async function startDropboxStreamUpload(filename) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            if (!res.dropbox_token) {
                return reject(new Error("Dropbox token not found. Please login in settings."));
            }
            const token = res.dropbox_token;

            const initXhr = new XMLHttpRequest();
            initXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/start');
            initXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            initXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            initXhr.setRequestHeader('Dropbox-API-Arg', JSON.stringify({ close: false }));

            initXhr.onload = () => {
                if (initXhr.status === 200 || initXhr.status === 201) {
                    try {
                        const response = JSON.parse(initXhr.responseText);
                        resolve(response.session_id);
                    } catch (e) {
                        reject(new Error("Failed to parse Dropbox session ID"));
                    }
                } else if (initXhr.status === 401) {
                    reauthDropbox().then(() => {
                        startDropboxStreamUpload(filename).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox Stream Init Error: " + initXhr.statusText));
                }
            };
            initXhr.onerror = () => reject(new Error("Network error during Dropbox stream init"));
            initXhr.send();
        } catch (e) {
            reject(e);
        }
    });
}

async function appendDropboxStream(sessionId, offset, chunk) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            const token = res.dropbox_token;
            if (!token) return reject(new Error("Dropbox token missing"));

            const appendXhr = new XMLHttpRequest();
            appendXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/append_v2');
            appendXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            appendXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            appendXhr.setRequestHeader('Dropbox-API-Arg', JSON.stringify({
                cursor: {
                    session_id: sessionId,
                    offset: offset
                },
                close: false
            }));

            appendXhr.onload = () => {
                if (appendXhr.status === 200 || appendXhr.status === 201) {
                    resolve();
                } else if (appendXhr.status === 401) {
                    reauthDropbox().then(() => {
                        appendDropboxStream(sessionId, offset, chunk).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox append error: " + appendXhr.statusText));
                }
            };
            appendXhr.onerror = () => reject(new Error("Network error during Dropbox append"));
            appendXhr.send(chunk);
        } catch (e) {
            reject(e);
        }
    });
}

async function finishDropboxStream(sessionId, offset, filename) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            const token = res.dropbox_token;
            if (!token) return reject(new Error("Dropbox token missing"));

            const finishXhr = new XMLHttpRequest();
            finishXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/finish');
            finishXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            finishXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            const apiArgRaw = JSON.stringify({
                cursor: { session_id: sessionId, offset: offset },
                commit: {
                    path: "/" + filename.replace(/[/\\?%*:|"<>]/g, '-'),
                    mode: "add", autorename: true, mute: false
                }
            });
            const apiArg = apiArgRaw.replace(/[\u007f-\uffff]/g, function(c) {
                return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
            });
            finishXhr.setRequestHeader('Dropbox-API-Arg', apiArg);

            finishXhr.onload = () => {
                if (finishXhr.status === 200 || finishXhr.status === 201) {
                    resolve();
                } else if (finishXhr.status === 401) {
                    reauthDropbox().then(() => {
                        finishDropboxStream(sessionId, offset, filename).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox finish error: " + finishXhr.statusText));
                }
            };
            finishXhr.onerror = () => reject(new Error("Network error during Dropbox finish"));
            finishXhr.send();
        } catch (e) {
            reject(e);
        }
    });
}

async function startGDriveStreamUpload(filename, totalSize, contentType, isRetry = false) {
    const res = await browser.storage.local.get('gdrive_token');
    if (!res.gdrive_token) throw new Error("Google Drive token not found");
    const token = res.gdrive_token;

    const metadata = {
        name: filename,
        mimeType: contentType || 'application/octet-stream'
    };

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': contentType || 'application/octet-stream',
            'X-Upload-Content-Length': totalSize || '*'
        },
        body: JSON.stringify(metadata)
    });

    if (response.status === 401 && !isRetry) {
        try {
            await reauthGDrive();
            return await startGDriveStreamUpload(filename, totalSize, contentType, true);
        } catch (e) {
            throw new Error("GDrive Session Init Error (401): " + response.statusText);
        }
    } else if (response.status !== 200 && response.status !== 201) {
        throw new Error("GDrive Session Init Error: " + response.statusText);
    }

    return response.headers.get('Location');
}

async function uploadStreamChunk(sessionUri, chunk, offset, totalSize) {
    const total = (totalSize !== undefined && totalSize !== null) ? totalSize : '*';
    let contentRange;
    if (chunk && chunk.byteLength > 0) {
        const end = offset + chunk.byteLength;
        contentRange = `bytes ${offset}-${end - 1}/${total}`;
    } else {

        contentRange = `bytes */${total}`;
        if (total === '*') return; // Cannot finalize with unknown size and no data
        chunk = new Uint8Array(0);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for each chunk

    try {
        const response = await fetch(sessionUri, {
            method: 'PUT',
            headers: {
                'Content-Range': contentRange
            },
            body: chunk,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status !== 308 && response.status !== 200 && response.status !== 201) {
            throw new Error("GDrive Chunk Upload Error: " + response.status);
        }

        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}
function mulaiSapuanMacet() {
    const BATAS_AWAL_MS = 60000;
    const BATAS_DIAM_MS = 120000;
    const INTERVAL_MS = 15000;
    setInterval(() => {
        const kini = Date.now();
        for (const [id, entri] of activeDownloads) {
            if (entri && entri.isNative && typeof entri.url === 'string' && entri.url.startsWith('blob:') && !(entri.loaded > 0)) {
                if (entri.pertamaDilihat === undefined) entri.pertamaDilihat = kini;
                if (kini - entri.pertamaDilihat >= BATAS_AWAL_MS) {
                    try { browser.downloads.cancel(id).catch(() => {}); } catch (e) {}
                    try { browser.downloads.erase(id).catch(() => {}); } catch (e) {}
                    activeDownloads.delete(id);
                    removeDownloadState(id);
                }
                continue;
            }
            if (!entri || entri.isPaused || entri.isZip || entri.isAudioJob || entri.isStreamJob || entri.isPersistentZipJob || entri.isCachedSave || entri.isNative) continue;
            if (!entri.abortController) continue;
            const statusNormal = String(entri.status || '').trim().toLowerCase();
            if (statusNormal === 'complete' || statusNormal === 'completed') continue;
            const total = entri.total || 0;
            const loaded = entri.loaded || 0;
            if (total > 0 && loaded >= total) continue;
            if (entri.terakhirLoaded === undefined || entri.terakhirLoaded !== loaded) {
                entri.terakhirLoaded = loaded;
                entri.terakhirBergerak = kini;
                if (entri.pertamaDilihat === undefined) entri.pertamaDilihat = kini;
                continue;
            }
            const batas = loaded === 0 ? BATAS_AWAL_MS : BATAS_DIAM_MS;
            const acuan = loaded === 0 ? (entri.pertamaDilihat || entri.terakhirBergerak) : entri.terakhirBergerak;
            if (kini - acuan >= batas) {
                entri.gagalKarenaMacet = true;
                try { entri.abortController.abort(); } catch (e) {}
            }
        }
    }, INTERVAL_MS);
}

mulaiSapuanMacet();
