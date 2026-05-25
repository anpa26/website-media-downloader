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

const urlParams = new URLSearchParams(window.location.search);
const downloadId = urlParams.get('id');
const targetUrl = urlParams.get('url');
const cacheKey = downloadId || targetUrl;
const filename = urlParams.get('filename') || browser.i18n.getMessage("defaultMediaName");

const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";
const CHUNK_STORE_NAME = "download-chunks";

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onerror = (event) => reject(event.target.error || browser.i18n.getMessage("idbOpenError") || "IDB Open Error");
        request.onblocked = () => {
            console.warn("IndexedDB blocked. Please close other tabs of this extension.");
            const title = document.getElementById('status-title');
            if (title) title.textContent = browser.i18n.getMessage("downloadWaiting");
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

async function triggerDownload() {
    const statusTitle = document.getElementById('status-title');
    const statusText = document.getElementById('status-text');
    const saveButton = document.getElementById('save-button');

    try {
        statusText.textContent = browser.i18n.getMessage("downloadConnectingDB");
        const db = await openCacheDB();

        statusText.textContent = browser.i18n.getMessage("downloadFetchingMetadata");
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(cacheKey);

        getRequest.onsuccess = async (event) => {
            try {
                const item = event.target.result;
                if (item) {
                    let blob;
                    if (item.data) {

                        blob = item.data;
                    } else {

                        statusTitle.textContent = browser.i18n.getMessage("downloadProcessing");
                        statusText.textContent = browser.i18n.getMessage("downloadReconstructing");

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
                                        statusText.textContent = browser.i18n.getMessage("downloadReconstructingSegments", [chunks.length.toString()]);
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
                            throw new Error(browser.i18n.getMessage("downloadMetadataNotFound"));
                        }

                        // Ensure they are strictly ordered by byte offset
                        chunks.sort((a, b) => a.index - b.index);

                        statusText.textContent = browser.i18n.getMessage("downloadAssembling", [chunks.length.toString()]);
                        const blobData = chunks.map(c => c.data);
                        blob = new Blob(blobData, { type: item.mime || "application/octet-stream" });
                    }

                    const objectUrl = URL.createObjectURL(blob);

                    statusTitle.textContent = browser.i18n.getMessage("downloadReadyTitle");
                    saveButton.style.display = "inline-block";
                    saveButton.textContent = browser.i18n.getMessage("saveFileLabel", [filename]);
                    statusText.textContent = browser.i18n.getMessage("downloadReadyText");

                    const closeButton = document.getElementById('close-button');
                    closeButton.onclick = () => window.close();

                    const performDownload = () => {
                        const a = document.createElement("a");
                        a.href = objectUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);

                        statusTitle.textContent = browser.i18n.getMessage("downloadStartedTitle");
                        statusText.textContent = browser.i18n.getMessage("downloadStartedText");
                        saveButton.disabled = true;
                        saveButton.style.opacity = "0.5";

                        const isAndroid = /Android/i.test(navigator.userAgent);
                        setTimeout(() => {
                            URL.revokeObjectURL(objectUrl);
                            try {
                                const delTx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
                                delTx.objectStore(STORE_NAME).delete(cacheKey);
                                const chunkRange = IDBKeyRange.bound([cacheKey, 0], [cacheKey, Infinity]);
                                delTx.objectStore(CHUNK_STORE_NAME).delete(chunkRange);
                            } catch (e) { console.warn("Cleanup failed:", e); }
                            window.close();
                        }, isAndroid ? 5000 : 2000);
                    };

                    saveButton.onclick = performDownload;
                    performDownload();
                } else {
                    statusTitle.textContent = browser.i18n.getMessage("downloadErrorTitle");
                    statusText.textContent = browser.i18n.getMessage("downloadMetadataNotFound");
                    setTimeout(() => window.close(), 5000);
                }
            } catch (innerError) {
                statusTitle.textContent = browser.i18n.getMessage("downloadProcessingError");
                statusText.textContent = innerError.message;
            }
        };

        getRequest.onerror = (e) => {
            statusTitle.textContent = browser.i18n.getMessage("downloadDatabaseError");
            statusText.textContent = browser.i18n.getMessage("downloadDatabaseErrorText");
        };

    } catch (error) {
        statusTitle.textContent = browser.i18n.getMessage("downloadUnexpectedError");
        statusText.textContent = error.message;
        setTimeout(() => window.close(), 5000);
    }
}

document.addEventListener('DOMContentLoaded', async () => {

    const colorResult = await browser.storage.local.get('theme-color');
    if (typeof mdui !== 'undefined') {
        mdui.setColorScheme(colorResult['theme-color'] || '#bbdefb');
    }

    if (targetUrl) {
        triggerDownload();
    } else {
        window.close();
    }
});
