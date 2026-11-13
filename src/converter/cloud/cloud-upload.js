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
                    // If we paused during an active chunk, set the resume hook to retry this chunk
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
