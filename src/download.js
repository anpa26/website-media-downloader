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

if (typeof browser === 'undefined') {
    var browser = chrome;
}

async function ensureScriptLoaded(src, globalVarName) {
  if (typeof window[globalVarName] !== 'undefined') return;
  if (document.querySelector(`script[src="${src}"]`)) {
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (typeof window[globalVarName] !== 'undefined') {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
    return;
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = browser.runtime.getURL(src);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(s);
  });
}

const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";
const CHUNK_STORE_NAME = "download-chunks";

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onerror = (event) => reject(event.target.error || browser.i18n.getMessage("idbOpenError") || "IDB Open Error");
        request.onblocked = () => {
            console.warn("IndexedDB blocked. Please close other tabs of this extension.");
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "url" });
            }
            if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
                db.createObjectStore(CHUNK_STORE_NAME, { keyPath: ["downloadId", "chunkIndex"] });
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

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

async function reauthGDrive() {
    return new Promise((resolve, reject) => {
        try {
            const clientId = "1042907477337-c8h27qniercjia05jqqafgvjao514n28.apps.googleusercontent.com";
            let finalRedirectUri;
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
                finalRedirectUri = browser.identity.getRedirectURL();
            } else {
                const id = browser.runtime.id;
                if (id && id.includes('@')) {
                    finalRedirectUri = `https://${encodeURIComponent(id)}.extensions.allizom.org/`;
                } else {
                    finalRedirectUri = "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
                }
            }

            const scope = encodeURIComponent("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email");
            const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;
            const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(finalRedirectUri)}&scope=${scope}&prompt=none`;
            
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                browser.identity.launchWebAuthFlow({
                    url: authUrl,
                    interactive: false
                }).then(async (redirectUrl) => {
                    if (redirectUrl) {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                        if (accessToken) {
                            await browser.storage.local.set({ 'gdrive_token': accessToken });
                            resolve(accessToken);
                        } else {
                            reject(new Error("No access token in redirect URL"));
                        }
                    } else {
                        reject(new Error("No redirect URL"));
                    }
                }).catch(reject);
            } else {
                let isResolved = false;
                let authTabId = null;

                const updatedListener = async (tabId, changeInfo, tab) => {
                    const urlString = changeInfo.url || tab.url;
                    if (urlString && urlString.includes(normalizedRedirectUri) && (urlString.includes('access_token=') || urlString.includes('error='))) {
                        if (!isResolved) {
                            isResolved = true;
                            browser.tabs.remove(tabId).catch(() => {});
                            cleanup();
                            const url = new URL(urlString);
                            const hashParams = new URLSearchParams(url.hash.substring(1));
                            const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                            
                            if (accessToken) {
                                await browser.storage.local.set({ 'gdrive_token': accessToken });
                                resolve(accessToken);
                            } else {
                                reject(new Error("Failed to reauth: " + (hashParams.get('error') || "No access token")));
                            }
                        }
                    }
                };

                const removedListener = (tabId) => {
                    if (authTabId && tabId === authTabId && !isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(new Error("Reauth tab closed"));
                    }
                };

                const cleanup = () => {
                    browser.tabs.onUpdated.removeListener(updatedListener);
                    browser.tabs.onRemoved.removeListener(removedListener);
                };

                browser.tabs.onUpdated.addListener(updatedListener);
                browser.tabs.onRemoved.addListener(removedListener);

                browser.tabs.create({ url: authUrl, active: false }).then(tab => {
                    authTabId = tab.id;
                }).catch(e => {
                    if (!isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(e);
                    }
                });
            }
        } catch (e) {
            reject(e);
        }
    });
}

async function reauthDropbox() {
    return new Promise((resolve, reject) => {
        try {
            const clientId = "gipboqpkook5oaj";
            let finalRedirectUri;
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
                finalRedirectUri = browser.identity.getRedirectURL();
            } else {
                const id = browser.runtime.id;
                if (id && id.includes('@')) {
                    finalRedirectUri = "https://" + encodeURIComponent(id) + ".extensions.allizom.org/";
                } else {
                    finalRedirectUri = "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
                }
            }
            
            const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;
            const authUrl = "https://www.dropbox.com/oauth2/authorize?client_id=" + clientId + "&response_type=token&redirect_uri=" + encodeURIComponent(finalRedirectUri);

            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                browser.identity.launchWebAuthFlow({
                    url: authUrl,
                    interactive: false
                }).then(redirectUrl => {
                    if (redirectUrl) {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                        if (accessToken) {
                            browser.storage.local.set({ 'dropbox_token': accessToken }).then(() => resolve(accessToken));
                        } else {
                            reject(new Error("No access token found in redirect URL"));
                        }
                    } else {
                        reject(new Error("No redirect URL returned"));
                    }
                }).catch(reject);
            } else {
                let isResolved = false;
                let authTabId = null;

                const updatedListener = async (tabId, changeInfo, tab) => {
                    const urlString = changeInfo.url || tab.url;
                    if (urlString && urlString.includes(normalizedRedirectUri) && (urlString.includes('access_token=') || urlString.includes('error='))) {
                        if (!isResolved) {
                            isResolved = true;
                            browser.tabs.remove(tabId).catch(() => {});
                            cleanup();
                            const url = new URL(urlString);
                            const hashParams = new URLSearchParams(url.hash.substring(1));
                            const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                            
                            if (accessToken) {
                                browser.storage.local.set({ 'dropbox_token': accessToken }).then(() => resolve(accessToken));
                            } else {
                                reject(new Error("Failed to reauth Dropbox"));
                            }
                        }
                    }
                };

                const removedListener = (tabId) => {
                    if (authTabId && tabId === authTabId && !isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(new Error("Reauth tab closed"));
                    }
                };

                const cleanup = () => {
                    browser.tabs.onUpdated.removeListener(updatedListener);
                    browser.tabs.onRemoved.removeListener(removedListener);
                };

                browser.tabs.onUpdated.addListener(updatedListener);
                browser.tabs.onRemoved.addListener(removedListener);

                browser.tabs.create({ url: authUrl, active: false }).then(tab => {
                    authTabId = tab.id;
                }).catch(e => {
                    if (!isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(e);
                    }
                });
            }
        } catch (e) {
            reject(e);
        }
    });
}

function uploadToDropbox(blob, filename, onProgress, controller, isRetry = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            if (!res.dropbox_token) {
                return reject(new Error(browser.i18n.getMessage("dropboxLoginRequired") || "Dropbox token not found. Please login in settings."));
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
                    onProgress(percent);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200 || xhr.status === 201) {
                    resolve();
                } else if (xhr.status === 401 && !isRetry) {
                    reauthDropbox().then(() => {
                        uploadToDropbox(blob, filename, onProgress, controller, true).then(resolve).catch(reject);
                    }).catch(() => {
                        reject(new Error(browser.i18n.getMessage("dropboxSessionExpired") || "Dropbox session expired. Please re-login in settings."));
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
                            reject(new Error(browser.i18n.getMessage("gdriveSessionExpired") || "Google Drive session expired. Please re-login in settings."));
                        });
                    } else {
                        reject(new Error(browser.i18n.getMessage("gdriveSessionExpired") || "Google Drive session expired. Please re-login in settings."));
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

const activeJobs = new Map();

async function getStoredDownloads() {
    const res = await browser.storage.local.get('active_manager_downloads');
    return res['active_manager_downloads'] || [];
}

async function saveStoredDownloads(downloads) {
    await browser.storage.local.set({ 'active_manager_downloads': downloads });
}

async function removeStoredDownload(id) {
    const currentStored = await getStoredDownloads();
    const updated = currentStored.filter(item => item.id !== id);
    await saveStoredDownloads(updated);
}

async function deleteDownloadCacheAndStorage(id, url, { skipStorageRemoval = false } = {}) {
    if (!skipStorageRemoval) {
        await removeStoredDownload(id);
    }

    try {
        const cacheKey = id || url;
        const db = await openCacheDB();

        const tx1 = db.transaction([STORE_NAME], "readwrite");
        tx1.objectStore(STORE_NAME).delete(cacheKey);
        await new Promise((resolve, reject) => {
            tx1.oncomplete = resolve;
            tx1.onerror = () => reject(tx1.error);
        });

        const tx2 = db.transaction([CHUNK_STORE_NAME], "readwrite");
        const chunkStore = tx2.objectStore(CHUNK_STORE_NAME);
        const range = IDBKeyRange.bound([cacheKey, 0], [cacheKey, Infinity]);
        chunkStore.delete(range);
        await new Promise((resolve, reject) => {
            tx2.oncomplete = resolve;
            tx2.onerror = () => reject(tx2.error);
        });
    } catch (e) {
        console.warn("Failed to clean up cache for", id, e);
    }

    browser.runtime.sendMessage({ action: 'downloadComplete', id: id || url, url: url }).catch(() => {});
}

function getExtFromMime(mimeType) {
    if (!mimeType) return "";
    const mimeLower = mimeType.toLowerCase().trim();
    
    if (mimeLower.includes("video/mp4")) return ".mp4";
    if (mimeLower.includes("video/webm")) return ".webm";
    if (mimeLower.includes("video/ogg")) return ".ogg";
    if (mimeLower.includes("video/quicktime")) return ".mov";
    if (mimeLower.includes("video/x-matroska")) return ".mkv";
    if (mimeLower.includes("video/x-msvideo")) return ".avi";
    if (mimeLower.includes("video/x-flv")) return ".flv";
    if (mimeLower.includes("video/3gpp")) return ".3gp";
    
    if (mimeLower.includes("audio/mpeg") || mimeLower.includes("audio/mp3")) return ".mp3";
    if (mimeLower.includes("audio/wav") || mimeLower.includes("audio/x-wav")) return ".wav";
    if (mimeLower.includes("audio/webm")) return ".webm";
    if (mimeLower.includes("audio/ogg") || mimeLower.includes("audio/opus")) return ".ogg";
    if (mimeLower.includes("audio/aac")) return ".aac";
    if (mimeLower.includes("audio/flac")) return ".flac";
    if (mimeLower.includes("audio/x-m4a") || mimeLower.includes("audio/m4a") || mimeLower.includes("audio/mp4")) return ".m4a";
    
    if (mimeLower.includes("image/jpeg") || mimeLower.includes("image/jpg")) return ".jpg";
    if (mimeLower.includes("image/png")) return ".png";
    if (mimeLower.includes("image/gif")) return ".gif";
    if (mimeLower.includes("image/webp")) return ".webp";
    if (mimeLower.includes("image/svg+xml")) return ".svg";
    
    if (mimeLower.includes("application/zip")) return ".zip";
    if (mimeLower.includes("application/pdf")) return ".pdf";
    if (mimeLower.includes("text/vtt")) return ".vtt";
    if (mimeLower.includes("application/x-subrip")) return ".srt";
    
    if (mimeLower.startsWith("video/")) {
        const sub = mimeLower.substring(6);
        if (/^[a-z0-9]+$/.test(sub)) return "." + sub;
    }
    if (mimeLower.startsWith("audio/")) {
        const sub = mimeLower.substring(6);
        if (/^[a-z0-9]+$/.test(sub)) {
            if (sub === "mpeg") return ".mp3";
            return "." + sub;
        }
    }
    if (mimeLower.startsWith("image/")) {
        const sub = mimeLower.substring(6);
        if (/^[a-z0-9]+$/.test(sub)) return "." + sub;
    }

    return "";
}

function ensureFileExtension(filename, mimeType) {
    if (!filename) return filename;
    filename = filename.trim();
    
    const hasExtension = /\.[a-zA-Z0-9]{1,5}$/.test(filename);
    if (hasExtension) {
        return filename;
    }
    
    const ext = getExtFromMime(mimeType);
    if (ext) {
        return filename + ext;
    }
    
    return filename;
}

async function triggerDownload(id, url, filename) {
    const statusText = document.getElementById(`status-text-${id}`);
    const progressContainer = document.getElementById(`progress-container-${id}`);
    const progress = document.getElementById(`progress-${id}`);
    const saveButton = document.getElementById(`save-${id}`);
    const pauseBtn = document.getElementById(`pause-${id}`);
    const resumeBtn = document.getElementById(`resume-${id}`);
    const cancelBtn = document.getElementById(`cancel-${id}`);

    const setStatus = (text) => { if (statusText) statusText.textContent = text; };

    try {
        setStatus(browser.i18n.getMessage("downloadConnectingDB") || "Connecting to Database...");
        const db = await openCacheDB();

        setStatus(browser.i18n.getMessage("downloadFetchingMetadata") || "Fetching Metadata...");
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const cacheKey = id || url;
        const getRequest = store.get(cacheKey);

        getRequest.onsuccess = async (event) => {
            try {
                const item = event.target.result;
                if (item) {
                    let blob;
                    if (item.data) {
                        blob = item.data;
                    } else {
                        setStatus(browser.i18n.getMessage("downloadReconstructing") || "Reconstructing file from segments...");
                        const chunks = [];
                        const chunkTx = db.transaction([CHUNK_STORE_NAME], "readonly");
                        const chunkStore = chunkTx.objectStore(CHUNK_STORE_NAME);

                        const range = IDBKeyRange.bound([cacheKey, 0], [cacheKey, Infinity]);
                        const cursorRequest = chunkStore.openCursor(range);

                        let lastUpdate = Date.now();
                        await new Promise((resolveChunk, rejectChunk) => {
                            cursorRequest.onsuccess = (e) => {
                                const cursor = e.target.result;
                                if (cursor) {
                                    chunks.push({ 
                                        index: cursor.value.chunkIndex, 
                                        data: cursor.value.data 
                                    });

                                    const now = Date.now();
                                    if (now - lastUpdate > 500) {
                                        setStatus((browser.i18n.getMessage("downloadReconstructingSegment") || "Reconstructing segment $1...").replace("$1", chunks.length));
                                        lastUpdate = now;
                                    }
                                    cursor.continue();
                                } else {
                                    resolveChunk();
                                }
                            };
                            cursorRequest.onerror = (e) => rejectChunk(e.target.error);
                        });

                        if (chunks.length === 0) {
                            throw new Error(browser.i18n.getMessage("downloadMetadataNotFound") || "Metadata not found in Database.");
                        }

                        chunks.sort((a, b) => a.index - b.index);
                        setStatus((browser.i18n.getMessage("downloadAssemblingParts") || "Assembling $1 parts...").replace("$1", chunks.length));
                        const blobData = chunks.map(c => c.data);
                        blob = new Blob(blobData, { type: item.mime || "application/octet-stream" });
                    }

                    const mimeType = item.mime || blob.type || "";
                    const originalFilename = filename;
                    filename = ensureFileExtension(filename, mimeType);

                    if (filename !== originalFilename) {
                        const card = document.getElementById(`card-${id}`);
                        if (card) {
                            const nameEl = card.querySelector('.file-name');
                            if (nameEl) {
                                nameEl.textContent = filename;
                            }
                        }
                        activeJobs.set(id, { url, filename });
                        try {
                            const stored = await getStoredDownloads();
                            let updated = false;
                            for (const storedItem of stored) {
                                if (storedItem.id === id) {
                                    storedItem.filename = filename;
                                    updated = true;
                                }
                            }
                            if (updated) {
                                await saveStoredDownloads(stored);
                            }
                        } catch (e) {
                            console.warn("Failed to update stored download filename extension:", e);
                        }
                    }

                    const objectUrl = URL.createObjectURL(blob);
                    const settings = await browser.storage.local.get(['save-to-gdrive', 'save-to-dropbox']);

                    if (settings['save-to-dropbox'] === '1') {
                        const controller = new CloudUploadController();
                        if (pauseBtn) {
                            pauseBtn.style.display = 'inline-block';
                            cancelBtn.style.display = 'inline-block';
                            
                            pauseBtn.onclick = () => {
                                controller.pause();
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'inline-block';
                                setStatus(browser.i18n.getMessage("uploadPausedTitle") || "Upload Paused");
                            };

                            resumeBtn.onclick = () => {
                                controller.resume();
                                resumeBtn.style.display = 'none';
                                pauseBtn.style.display = 'inline-block';
                                setStatus(browser.i18n.getMessage("uploadingToDropbox", [filename]) || `Uploading ${filename} to Dropbox...`);
                            };

                            cancelBtn.onclick = () => {
                                controller.cancel();
                            };
                        }

                        try {
                            setStatus((browser.i18n.getMessage("uploadingToDropbox", [filename]) || `Uploading ${filename} to Dropbox...`) + " (0%)");
                            if (progressContainer) progressContainer.style.display = 'block';
                            if (progress) progress.style.width = '0%';
                            
                            await uploadToDropbox(blob, filename, (percent) => {
                                setStatus((browser.i18n.getMessage("uploadingToDropbox", [filename]) || `Uploading ${filename} to Dropbox...`) + ` (${percent}%)`);
                                if (progress) progress.style.width = percent + '%';
                            }, controller);

                            if (pauseBtn) {
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'none';
                                cancelBtn.style.display = 'none';
                            }
                            if (progressContainer) progressContainer.style.display = 'none';
                            setStatus(browser.i18n.getMessage("uploadSuccessDropbox", [filename]) || `Successfully saved ${filename} to Dropbox!`);
                            browser.runtime.sendMessage({ action: 'downloadComplete', id: cacheKey, url: url, cloud: true }).catch(() => {});
                            await removeStoredDownload(id);
                            return;
                        } catch (error) {
                            if (pauseBtn) {
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'none';
                                cancelBtn.style.display = 'none';
                            }
                            if (progressContainer) progressContainer.style.display = 'none';
                            if (error.message === "Upload cancelled") {
                                setStatus(browser.i18n.getMessage("uploadCancelledTitle") || "Upload Cancelled");
                            } else {
                                setStatus((browser.i18n.getMessage("uploadFailedDropbox") || "Dropbox Upload Failed") + `: ${error.message}`);
                            }
                            return;
                        }
                    } else if (settings['save-to-gdrive'] === '1') {
                        const controller = new CloudUploadController();
                        if (pauseBtn) {
                            pauseBtn.style.display = 'inline-block';
                            cancelBtn.style.display = 'inline-block';

                            pauseBtn.onclick = () => {
                                controller.pause();
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'inline-block';
                                setStatus(browser.i18n.getMessage("uploadPausedTitle") || "Upload Paused");
                            };

                            resumeBtn.onclick = () => {
                                controller.resume();
                                resumeBtn.style.display = 'none';
                                pauseBtn.style.display = 'inline-block';
                                setStatus(browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...");
                            };

                            cancelBtn.onclick = () => {
                                controller.cancel();
                            };
                        }

                        try {
                            setStatus(browser.i18n.getMessage("uploadingToGDrive", [filename]) || `Uploading ${filename} to Google Drive...`);
                            if (progressContainer) progressContainer.style.display = 'block';
                            if (progress) progress.style.width = '0%';
                            
                            await uploadToGDrive(blob, filename, (percent) => {
                                setStatus((browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${percent}%)`);
                                if (progress) progress.style.width = percent + '%';
                            }, controller);
                            
                            if (pauseBtn) {
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'none';
                                cancelBtn.style.display = 'none';
                            }
                            if (progressContainer) progressContainer.style.display = 'none';
                            setStatus(browser.i18n.getMessage("uploadSuccessGDrive", [filename]) || `Successfully saved ${filename} to Google Drive!`);
                            browser.runtime.sendMessage({ action: 'downloadComplete', id: cacheKey, url: url, cloud: true }).catch(() => {});
                            await removeStoredDownload(id);
                            return;
                        } catch (error) {
                            if (pauseBtn) {
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'none';
                                cancelBtn.style.display = 'none';
                            }
                            if (progressContainer) progressContainer.style.display = 'none';
                            if (error.message === "Upload cancelled") {
                                setStatus(browser.i18n.getMessage("uploadCancelledTitle") || "Upload Cancelled");
                            } else {
                                setStatus((browser.i18n.getMessage("uploadFailedGDrive") || "Cloud upload failed") + `: ${error.message}`);
                            }
                            return;
                        }
                    }

                    setStatus(browser.i18n.getMessage("downloadReadyText") || "Ready to Save");
                    
                    const previewBtn = document.getElementById(`preview-${id}`);
                    const previewContainer = document.getElementById(`preview-container-${id}`);
                    
                    const isVideo = mimeType.startsWith("video/") || /\.(mp4|webm|ogg|mkv|mov|avi|flv)$/i.test(filename);
                    const isAudio = mimeType.startsWith("audio/") || /\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(filename);

                    if (previewBtn && previewContainer && (isVideo || isAudio)) {
                        previewBtn.style.display = "inline-block";
                        previewBtn.onclick = () => {
                            if (previewContainer.style.display === "none") {
                                previewContainer.innerHTML = "";
                                if (isVideo) {
                                    const video = document.createElement("video");
                                    video.src = objectUrl;
                                    video.controls = true;
                                    video.style.width = "100%";
                                    video.style.maxHeight = "360px";
                                    video.autoplay = true;
                                    previewContainer.appendChild(video);
                                } else if (isAudio) {
                                    const audio = document.createElement("audio");
                                    audio.src = objectUrl;
                                    audio.controls = true;
                                    audio.style.width = "100%";
                                    audio.style.padding = "10px";
                                    audio.autoplay = true;
                                    previewContainer.appendChild(audio);
                                }
                                previewContainer.style.display = "block";
                                previewBtn.textContent = browser.i18n.getMessage("closePreview") || "Close Preview";
                            } else {
                                previewContainer.innerHTML = "";
                                previewContainer.style.display = "none";
                                previewBtn.textContent = browser.i18n.getMessage("previewMedia") || "Preview";
                            }
                        };
                    }

                    if (saveButton) {
                        saveButton.style.display = "inline-block";
                        
                        const performDownload = async () => {
                            const a = document.createElement("a");
                            a.href = objectUrl;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);

                            setStatus(browser.i18n.getMessage("downloadStartedText") || "Download Started");
                            saveButton.disabled = true;
                            saveButton.style.opacity = "0.5";
                            browser.runtime.sendMessage({ action: 'downloadComplete', id: cacheKey, url: url }).catch(() => {});
                            await removeStoredDownload(id);
                        };

                        saveButton.onclick = performDownload;
                    }
                } else {
                    setStatus(browser.i18n.getMessage("downloadMetadataNotFound") || "Metadata not found in Database.");
                }
            } catch (innerError) {
                setStatus((browser.i18n.getMessage("downloadProcessingError") || "Processing Error") + `: ${innerError.message}`);
            }
        };

        getRequest.onerror = () => {
            setStatus(browser.i18n.getMessage("downloadDatabaseErrorText") || "Database retrieval failed.");
        };

    } catch (error) {
        setStatus((browser.i18n.getMessage("downloadUnexpectedError") || "Unexpected Error") + `: ${error.message}`);
    }
}

async function addNewDownload(id, url, filename) {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';

    const list = document.getElementById('downloads-list');
    
    if (document.getElementById(`card-${id}`)) return;

    const stored = await getStoredDownloads();
    if (!stored.some(item => item.id === id)) {
        stored.push({ id, url, filename });
        await saveStoredDownloads(stored);
    }

    const card = document.createElement('div');
    card.className = 'download-card';
    card.id = `card-${id}`;
    card.dataset.id = id;
    card.innerHTML = `
      <div class="card-content">
        <div class="card-header" style="align-items: center;">
          <mdui-checkbox class="card-select-checkbox" data-id="${id}" style="margin-right: -4px;"></mdui-checkbox>
          <div class="icon-wrapper">
            <mdui-icon>
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            </mdui-icon>
          </div>
          <div class="info-wrapper">
            <h4 class="file-name">${filename || browser.i18n.getMessage("defaultMediaName")}</h4>
            <p class="status-text" id="status-text-${id}">${browser.i18n.getMessage("downloadWaiting") || "Preparing..."}</p>
          </div>
        </div>
        <div class="progress-bar-wrapper">
          <mdui-linear-progress id="progress-${id}" value="0" style="display: none;"></mdui-linear-progress>
        </div>
        <div id="preview-container-${id}" style="display: none; margin-top: 10px; width: 100%; border-radius: 8px; overflow: hidden; background: #000; line-height: 0;"></div>
        <div class="button-group">
          <mdui-button id="preview-${id}" variant="tonal" style="display: none; color: rgb(var(--mdui-color-primary));">${browser.i18n.getMessage("previewMedia") || "Preview"}</mdui-button>
          <div style="flex-grow: 1;"></div>
          <mdui-button id="save-${id}" variant="filled" style="display: none;">${browser.i18n.getMessage("saveFileLabel") || "Save"}</mdui-button>
          <mdui-button id="pause-${id}" variant="tonal" style="display: none;">${browser.i18n.getMessage("uploadPausedTitle") || "Pause"}</mdui-button>
          <mdui-button id="resume-${id}" variant="filled" style="display: none;">${browser.i18n.getMessage("uploadResumedTitle") || "Resume"}</mdui-button>
          <mdui-button id="cancel-${id}" variant="outlined" style="display: none;">${browser.i18n.getMessage("uploadCancelledTitle") || "Cancel"}</mdui-button>
          <mdui-button id="close-${id}" variant="text">${browser.i18n.getMessage("closePreview") || "Close"}</mdui-button>
        </div>
      </div>
    `;
    list.appendChild(card);

    const closeBtn = document.getElementById(`close-${id}`);
    if (closeBtn) {
        closeBtn.onclick = async () => {
            card.remove();
            activeJobs.delete(id);
            await deleteDownloadCacheAndStorage(id, url);

            if (list.children.length === 0 && emptyState) {
                emptyState.style.display = 'flex';
            }
            updateSaveAllZipVisibility();
            updateSelectedCount();
        };
    }

    const cardCheckbox = card.querySelector('.card-select-checkbox');
    if (cardCheckbox) {
        cardCheckbox.addEventListener('change', () => {
            updateSelectedCount();
        });
    }

    const cacheKey = id || url;
    browser.runtime.sendMessage({ action: 'registerDownloadTab', id: cacheKey }).catch(() => {});

    activeJobs.set(id, { url, filename });
    triggerDownload(id, url, filename);
    
    updateSaveAllZipVisibility();
}

// Receive new downloads from background service worker
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'startDownload') return false;
    addNewDownload(message.id, message.url, message.filename)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
});

async function initTheme() {
    const result = await browser.storage.local.get(['theme-color', 'theme-mode']);
    const themeColor = result['theme-color'] || '#bbdefb';
    const themeMode = result['theme-mode'] || 'auto';

    if (typeof mdui !== 'undefined' && mdui.setColorScheme) {
        mdui.setColorScheme(themeColor);
    }

    const htmlEl = document.documentElement;
    htmlEl.classList.remove('mdui-theme-auto', 'mdui-theme-light', 'mdui-theme-dark', 'theme-pitch-black');
    
    if (themeMode === 'auto') {
        htmlEl.classList.add('mdui-theme-auto');
    } else if (themeMode === 'light') {
        htmlEl.classList.add('mdui-theme-light');
    } else if (themeMode === 'dark') {
        htmlEl.classList.add('mdui-theme-dark');
    } else if (themeMode === 'pitch-black') {
        htmlEl.classList.add('mdui-theme-dark');
        htmlEl.classList.add('theme-pitch-black');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await initTheme();
    const colorResult = await browser.storage.local.get('ui-scale');
    document.documentElement.style.zoom = colorResult['ui-scale'] || '85%';

    browser.storage.onChanged.addListener((changes) => {
        if (changes['theme-color'] || changes['theme-mode']) {
            initTheme();
        }
        if (changes['ui-scale']) {
            document.documentElement.style.zoom = changes['ui-scale'].newValue || '85%';
        }
    });

    browser.runtime.sendMessage({ action: 'registerDownloadManagerTab' }).catch(() => {});

    let stored = await getStoredDownloads();

    const urlParams = new URLSearchParams(window.location.search);
    const initialId = urlParams.get('id');
    const initialUrl = urlParams.get('url');
    const initialFilename = urlParams.get('filename') || browser.i18n.getMessage("defaultMediaName");

    if (initialId && initialUrl) {
        if (!stored.some(item => item.id === initialId)) {
            stored.push({ id: initialId, url: initialUrl, filename: initialFilename });
            await saveStoredDownloads(stored);
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (stored.length > 0) {
        for (const item of stored) {
            addNewDownload(item.id, item.url, item.filename);
        }
    }
    
    updateSaveAllZipVisibility();

    const saveAllZipBtn = document.getElementById('save-all-zip');
    if (saveAllZipBtn) {
        saveAllZipBtn.onclick = async () => {
            saveAllZipBtn.disabled = true;
            
            const checkedBoxes = Array.from(document.querySelectorAll('.card-select-checkbox')).filter(cb => cb.checked);
            const selectedIds = checkedBoxes.map(cb => cb.dataset.id);
            const isSelectedMode = selectedIds.length > 0;
            
            const originalText = saveAllZipBtn.textContent;
            saveAllZipBtn.textContent = isSelectedMode ? "Preparing Selected ZIP..." : "Preparing ZIP...";
            
            try {
                await ensureScriptLoaded('libraries/client-zip.js', 'downloadZip');
                let stored = await getStoredDownloads();
                if (isSelectedMode) {
                    stored = stored.filter(item => selectedIds.includes(item.id));
                }
                
                if (stored.length === 0) {
                    if (typeof mdui !== 'undefined' && mdui.snackbar) {
                        mdui.snackbar({ message: "No downloads available to save.", placement: "top" });
                    }
                    saveAllZipBtn.disabled = false;
                    saveAllZipBtn.textContent = originalText;
                    return;
                }

                const db = await openCacheDB();
                const zipEntries = [];

                for (let i = 0; i < stored.length; i++) {
                    const item = stored[i];
                    saveAllZipBtn.textContent = `Assembling file ${i+1}/${stored.length}...`;
                    
                    try {
                        const tx = db.transaction([STORE_NAME], "readonly");
                        const getRequest = tx.objectStore(STORE_NAME).get(item.id || item.url);
                        
                        const cacheItem = await new Promise((resolve, reject) => {
                            getRequest.onsuccess = (e) => resolve(e.target.result);
                            getRequest.onerror = (e) => reject(e.target.error);
                        });

                        if (cacheItem) {
                            let fileBlob;
                            if (cacheItem.data) {
                                fileBlob = cacheItem.data;
                            } else {
                                const chunks = [];
                                const chunkTx = db.transaction([CHUNK_STORE_NAME], "readonly");
                                const range = IDBKeyRange.bound([item.id || item.url, 0], [item.id || item.url, Infinity]);
                                const cursorRequest = chunkTx.objectStore(CHUNK_STORE_NAME).openCursor(range);
                                
                                await new Promise((resolveChunk, rejectChunk) => {
                                    cursorRequest.onsuccess = (e) => {
                                        const cursor = e.target.result;
                                        if (cursor) {
                                            chunks.push({ index: cursor.value.chunkIndex, data: cursor.value.data });
                                            cursor.continue();
                                        } else {
                                            resolveChunk();
                                        }
                                    };
                                    cursorRequest.onerror = (e) => rejectChunk(e.target.error);
                                });

                                if (chunks.length > 0) {
                                    chunks.sort((a, b) => a.index - b.index);
                                    fileBlob = new Blob(chunks.map(c => c.data), { type: cacheItem.mime || "application/octet-stream" });
                                }
                            }

                            if (fileBlob) {
                                let originalFileName = item.filename || "file";
                                const mimeType = cacheItem.mime || fileBlob.type || "";
                                originalFileName = ensureFileExtension(originalFileName, mimeType);
                                
                                let filename = originalFileName;
                                let counter = 1;
                                while (zipEntries.some(e => e.name === filename)) {
                                    const parts = originalFileName.split('.');
                                    if (parts.length > 1) {
                                        const ext = parts.pop();
                                        filename = `${parts.join('.')}_${counter}.${ext}`;
                                    } else {
                                        filename = `${originalFileName}_${counter}`;
                                    }
                                    counter++;
                                }
                                zipEntries.push({
                                    name: filename,
                                    input: fileBlob
                                });
                            }
                        }
                    } catch (err) {
                        console.error("Error reading file for zip generation:", item.filename, err);
                    }
                }

                if (zipEntries.length === 0) {
                    throw new Error("No files could be read from database. Make sure downloads are completed.");
                }

                saveAllZipBtn.textContent = "Generating ZIP...";
                const zipBlob = await downloadZip(zipEntries).blob();
                const zipName = `downloads_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
                
                const blobUrl = URL.createObjectURL(zipBlob);
                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = zipName;
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                }, 2000);

                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    mdui.snackbar({ message: "ZIP file generated successfully!", placement: "top" });
                }

            } catch (e) {
                console.error("ZIP Generation error:", e);
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    mdui.snackbar({ message: `ZIP Error: ${e.message}`, placement: "top" });
                }
            } finally {
                saveAllZipBtn.disabled = false;
                saveAllZipBtn.textContent = originalText;
            }
        };
    }

    const selectAllCheckbox = document.getElementById('select-all-downloads');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
            const isChecked = selectAllCheckbox.checked;
            const checkboxes = document.querySelectorAll('.card-select-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = isChecked;
            });
            updateSelectedCount();
        });
    }

    const deleteSelectedBtn = document.getElementById('delete-selected-downloads');
    if (deleteSelectedBtn) {
        deleteSelectedBtn.onclick = async () => {
            const checkedBoxes = Array.from(document.querySelectorAll('.card-select-checkbox')).filter(cb => cb.checked);
            if (checkedBoxes.length === 0) return;

            deleteSelectedBtn.disabled = true;

            const selectedIds = checkedBoxes.map(cb => cb.dataset.id);
            const selectedUrlMap = {};
            for (const id of selectedIds) {
                const job = activeJobs.get(id);
                selectedUrlMap[id] = job ? job.url : "";
                const card = document.getElementById(`card-${id}`);
                if (card) card.remove();
                activeJobs.delete(id);
            }

            // Batch-remove selected items from storage in one write to avoid race conditions
            const currentStored = await getStoredDownloads();
            const selectedSet = new Set(selectedIds);
            const remaining = currentStored.filter(item => !selectedSet.has(item.id));
            await saveStoredDownloads(remaining);

            // Now clean cache entries in parallel (skip per-item storage removal since we already did it)
            const deletePromises = selectedIds.map(id =>
                deleteDownloadCacheAndStorage(id, selectedUrlMap[id], { skipStorageRemoval: true })
            );

            const list = document.getElementById('downloads-list');
            const emptyState = document.getElementById('empty-state');
            if (list && list.children.length === 0 && emptyState) {
                emptyState.style.display = 'flex';
            }

            updateSaveAllZipVisibility();
            updateSelectedCount();

            await Promise.all(deletePromises);
            deleteSelectedBtn.disabled = false;
        };
    }

    const closeAllBtn = document.getElementById('close-all-downloads');
    if (closeAllBtn) {
        closeAllBtn.onclick = async () => {
            const confirmClose = confirm("Are you sure you want to close and clear all downloads?");
            if (!confirmClose) return;

            closeAllBtn.disabled = true;
            const stored = await getStoredDownloads();

            // Clear all items from storage in one write first to prevent stale entries on reload
            await saveStoredDownloads([]);

            // Remove cards from DOM and clear activeJobs
            for (const item of stored) {
                const card = document.getElementById(`card-${item.id}`);
                if (card) card.remove();
                activeJobs.delete(item.id);
            }

            const list = document.getElementById('downloads-list');
            const emptyState = document.getElementById('empty-state');
            if (list && emptyState) {
                list.innerHTML = "";
                emptyState.style.display = 'flex';
            }

            updateSaveAllZipVisibility();
            updateSelectedCount();

            // Clean cache entries in parallel (skip per-item storage removal since we already cleared all)
            const deletePromises = stored.map(item =>
                deleteDownloadCacheAndStorage(item.id, item.url, { skipStorageRemoval: true })
            );
            await Promise.all(deletePromises);
            closeAllBtn.disabled = false;
        };
    }
    
    const heartbeatInterval = setInterval(() => {
        browser.runtime.sendMessage({ action: 'heartbeat' }).catch(() => {});
    }, 15000);

    window.addEventListener('beforeunload', () => {
        clearInterval(heartbeatInterval);
    });
});

async function updateSaveAllZipVisibility() {
    const saveAllZipBtn = document.getElementById('save-all-zip');
    const listHeader = document.getElementById('list-header');
    if (!saveAllZipBtn || !listHeader) return;
    const stored = await getStoredDownloads();
    if (stored.length > 0) {
        listHeader.style.display = 'flex';
        saveAllZipBtn.style.display = 'inline-flex';
    } else {
        listHeader.style.display = 'none';
        saveAllZipBtn.style.display = 'none';
    }
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.card-select-checkbox');
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    
    const countSpan = document.getElementById('selected-downloads-count');
    if (countSpan) {
        countSpan.textContent = browser.i18n.getMessage("selectedCount", [checkedCount.toString()]) || `${checkedCount} selected`;
    }

    const deleteBtn = document.getElementById('delete-selected-downloads');
    if (deleteBtn) {
        deleteBtn.style.display = checkedCount > 0 ? 'inline-flex' : 'none';
    }

    const selectAllCheckbox = document.getElementById('select-all-downloads');
    if (selectAllCheckbox) {
        selectAllCheckbox.style.display = 'inline-block';
        if (checkboxes.length === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        } else if (checkedCount === checkboxes.length) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else if (checkedCount > 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }
    }

    const closeAllBtn = document.getElementById('close-all-downloads');
    if (closeAllBtn) {
        closeAllBtn.style.display = checkedCount > 0 ? 'none' : 'inline-flex';
    }

    const saveAllZipBtn = document.getElementById('save-all-zip');
    if (saveAllZipBtn) {
        saveAllZipBtn.textContent = checkedCount > 0 
            ? (browser.i18n.getMessage("saveSelectedZip") || "Save Selected as ZIP") 
            : (browser.i18n.getMessage("saveAllZip") || "Save All as ZIP");
    }
}
