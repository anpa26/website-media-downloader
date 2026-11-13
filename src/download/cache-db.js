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



const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";
const CHUNK_STORE_NAME = "download-chunks";

let _cachedDownloadDB = null;
function openCacheDB() {
    if (_cachedDownloadDB) return Promise.resolve(_cachedDownloadDB);
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
        request.onsuccess = (event) => {
            const db = event.target.result;
            db.onversionchange = () => {
                db.close();
                _cachedDownloadDB = null;
            };
            db.onclose = () => {
                _cachedDownloadDB = null;
            };
            _cachedDownloadDB = db;
            resolve(db);
        };
    });
}

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
