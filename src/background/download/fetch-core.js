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


const pendingSaveQueue = [];
let activeBridgeTabId = null;
const downloadTabs = new Map(); // tabId -> downloadId

async function cleanupDownload(id) {
    if (!id) return;
    try {
        const db = await getDB();
        const delTx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
        delTx.objectStore(STORE_NAME).delete(id);
        const chunkRange = IDBKeyRange.bound([id, 0], [id, Infinity]);
        delTx.objectStore(CHUNK_STORE_NAME).delete(chunkRange);
        await new Promise((resolve, reject) => {
            delTx.oncomplete = resolve;
            delTx.onerror = () => reject(delTx.error);
            delTx.onabort = () => reject(delTx.error);
        });
    } catch (e) { console.warn("Cleanup failed:", e); }
}

async function triggerHiddenDownload(id, filename) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isFirefox = typeof browser.runtime.getBrowserInfo === 'function' || !browser.offscreen;

    if (isAndroid) {
        return false;
    }

    if (isFirefox && typeof URL !== 'undefined' && URL.createObjectURL) {
        try {
            const db = await getDB();

            const item = await new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], "readonly");
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(id);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            const chunks = [];
            await new Promise((resolve, reject) => {
                const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
                const store = tx.objectStore(CHUNK_STORE_NAME);
                const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
                const request = store.openCursor(range);
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) { chunks.push(cursor.value.data); cursor.continue(); }
                    else resolve();
                };
                request.onerror = () => reject(request.error);
            });

            if (chunks.length === 0 && (!item || !item.data)) return false;

            let blobType = (item && item.mime) || "application/octet-stream";
            if (filename.toLowerCase().endsWith('.m4a') && blobType.includes('mp4')) {
                blobType = "application/octet-stream";
            }
            const finalBlob = chunks.length > 0
                ? new Blob(chunks, { type: blobType })
                : item.data;

            const blobUrl = URL.createObjectURL(finalBlob);
            const finalDownloadFilename = ensureFileExtension(filename, blobType);

            try {
                await browser.downloads.download({
                    url: blobUrl,
                    filename: sanitizeFilename(finalDownloadFilename),
                    saveAs: false
                });

                setTimeout(() => {
                    URL.revokeObjectURL(blobUrl);
                    cleanupDownload(id);
                }, 30000);
                return true;
            } catch (e) {
                URL.revokeObjectURL(blobUrl);
                throw e;
            }
        } catch (e) {
            console.error("Direct background download failed:", e);
        }
    }

    if (typeof browser.offscreen !== 'undefined') {
        try {
            const hasOffscreen = await browser.offscreen.hasDocument().catch(() => false);
            if (!hasOffscreen) {
                await browser.offscreen.createDocument({
                    url: 'pages/offscreen.html',
                    reasons: ['DOWNLOAD'],
                    justification: 'Triggering download for fetched media blob'
                });
            }

            const response = await browser.runtime.sendMessage({
                action: 'triggerOffscreenDownload',
                data: { id, filename }
            }).catch(e => ({ error: e.message }));

            if (response && response.success) {
                setTimeout(() => {
                    cleanupDownload(id);
                }, 10000);
                return true;
            }
        } catch (e) {
            console.error("Offscreen download failed:", e);
        }
    }

    return false;
}


function createMediaFetchOptions(url, originalRequest = null, signal = null) {
    const fetchOptions = {
        method: (originalRequest && originalRequest.method) ? originalRequest.method : 'GET',
        headers: (originalRequest && originalRequest.headers && !Array.isArray(originalRequest.headers)) ? { ...originalRequest.headers } : {},
        credentials: (originalRequest && originalRequest.credentials) ? originalRequest.credentials : 'include'
    };
    if (signal) fetchOptions.signal = signal;

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
                fetchOptions.headers.Cookie = value;
            } else if (name === 'referer') {
                fetchOptions.referrer = value;
                fetchOptions.headers.Referer = value;
            } else if (name !== 'host' && name !== 'content-length') {
                fetchOptions.headers[name] = value;
            }
        }
        if (storedHeaders.referer && !fetchOptions.headers.Origin) {
            try {
                const refUrl = new URL(storedHeaders.referer);
                if (refUrl.protocol.startsWith('http')) fetchOptions.headers.Origin = refUrl.origin;
            } catch (e) {}
        }
    }

    const manualReferer = originalRequest?.requestHeaders?.find(h => h.name.toLowerCase() === 'referer')?.value;
    if (manualReferer) {
        fetchOptions.referrer = manualReferer;
        fetchOptions.headers.Referer = manualReferer;
        if (!fetchOptions.headers.Origin) {
            try {
                const refUrl = new URL(manualReferer);
                if (refUrl.protocol.startsWith('http')) fetchOptions.headers.Origin = refUrl.origin;
            } catch (e) {}
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
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            fetchOptions.body = bytes;
        }
    }
    return fetchOptions;
}
