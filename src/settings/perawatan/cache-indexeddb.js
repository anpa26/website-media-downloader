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



function cacheMessage(key, substitutions, fallback) {
    const message = substitutions == null
        ? browser.i18n.getMessage(key)
        : browser.i18n.getMessage(key, substitutions);
    return message || fallback;
}

function openSettingsCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CACHE_DB_NAME, 3);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('network-cache')) {
                db.createObjectStore('network-cache', { keyPath: 'url' });
            }
            if (!db.objectStoreNames.contains('download-chunks')) {
                db.createObjectStore('download-chunks', { keyPath: ['downloadId', 'chunkIndex'] });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function cachedValueSize(value) {
    const data = value?.data;
    if (data instanceof Blob) return data.size;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    return 0;
}

async function readIndexedDBCacheUsage() {
    const db = await openSettingsCacheDB();
    let bytes = 0;
    let entries = 0;
    try {
        for (const storeName of CACHE_STORE_NAMES) {
            if (!db.objectStoreNames.contains(storeName)) continue;
            await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const request = tx.objectStore(storeName).openCursor();
                request.onsuccess = event => {
                    const cursor = event.target.result;
                    if (!cursor) return;
                    entries++;
                    bytes += cachedValueSize(cursor.value);
                    cursor.continue();
                };
                request.onerror = () => reject(request.error);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        }
    } finally {
        db.close();
    }
    return { bytes, entries };
}

async function clearIndexedDBCache() {
    const activeDownloads = await browser.runtime.sendMessage({ action: 'getActiveDownloads' }).catch(() => ({}));
    if (Object.keys(activeDownloads || {}).length > 0) {
        throw new Error(cacheMessage('cacheStorageActiveDownloadError', null, 'Cache cannot be cleared while downloads are active.'));
    }
    const db = await openSettingsCacheDB();
    try {
        const stores = CACHE_STORE_NAMES.filter(name => db.objectStoreNames.contains(name));
        if (!stores.length) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(stores, 'readwrite');
            stores.forEach(name => tx.objectStore(name).clear());
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Cache cleanup aborted'));
        });
    } finally {
        db.close();
    }
}

function setupIndexedDBCacheControls() {
    const status = document.getElementById('indexeddb-cache-status');
    const clearButton = document.getElementById('clear-indexeddb-cache');
    if (!status || !clearButton || clearButton.dataset.ready === '1') return;
    clearButton.dataset.ready = '1';

    const refresh = async () => {
        try {
            const usage = await readIndexedDBCacheUsage();
            const entries = cacheMessage('cacheStorageEntries', String(usage.entries), `${usage.entries} cached entries`);
            status.textContent = `${getHumanReadableSize(usage.bytes)} • ${entries}`;
        } catch (error) {
            status.textContent = cacheMessage('cacheStorageReadError', error.message, `Unable to read cache: ${error.message}`);
        }
    };

    clearButton.addEventListener('click', async () => {
        clearButton.loading = true;
        clearButton.disabled = true;
        try {
            await clearIndexedDBCache();
            await refresh();
            if (typeof mdui !== 'undefined' && mdui.snackbar) tampilnoNotif(cacheMessage('cacheStorageCleared', null, 'Cache cleared'));
        } catch (error) {
            if (typeof mdui !== 'undefined' && mdui.snackbar) tampilnoNotif(error.message);
        } finally {
            clearButton.loading = false;
            clearButton.disabled = false;
        }
    });
    refresh();
}
