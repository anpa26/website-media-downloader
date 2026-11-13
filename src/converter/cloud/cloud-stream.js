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

async function startGDriveStreamUpload(filename, totalSize, contentType) {
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

    if (response.status !== 200 && response.status !== 201) {
        throw new Error("GDrive Session Init Error: " + response.statusText);
    }

    return response.headers.get('Location');
}

async function uploadStreamChunk(sessionUri, chunk, offset, totalSize) {
    const total = (totalSize !== undefined && totalSize !== null) ? totalSize : '*';
    let contentRange;
    if (chunk && chunk.length > 0) {
        const end = offset + chunk.length;
        contentRange = `bytes ${offset}-${end - 1}/${total}`;
    } else {
        contentRange = `bytes */${total}`;
        if (total === '*') return;
        chunk = new Uint8Array(0);
    }

    const response = await fetch(sessionUri, {
        method: 'PUT',
        headers: {
            'Content-Range': contentRange
        },
        body: chunk
    });

    if (response.status !== 308 && response.status !== 200 && response.status !== 201) {
        throw new Error("GDrive Chunk Upload Error: " + response.status);
    }

    return response;
}
