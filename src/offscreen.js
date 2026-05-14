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

const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";
const CHUNK_STORE_NAME = "download-chunks";

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onerror = (event) => reject(event.target.error || browser.i18n.getMessage("idbOpenError") || "IDB Open Error");
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'triggerOffscreenDownload') {
        const { id, filename } = message.data;
        handleOffscreenDownload(id, filename)
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

async function handleOffscreenDownload(id, filename) {
    try {
        const db = await openCacheDB();

        const item = await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!item) throw new Error(browser.i18n.getMessage("metadataNotFoundError") || "Download metadata not found in database");

        const chunks = [];
        await new Promise((resolve, reject) => {
            const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
            const store = tx.objectStore(CHUNK_STORE_NAME);
            const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
            const request = store.openCursor(range);

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    chunks.push(cursor.value.data);
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });

        if (chunks.length === 0 && !item.data) throw new Error("No chunks found for download");

        const finalBlob = chunks.length > 0
            ? new Blob(chunks, { type: item.mime || "application/octet-stream" })
            : item.data;

        const objectUrl = URL.createObjectURL(finalBlob);

        try {
            await browser.downloads.download({
                url: objectUrl,
                filename: filename,
                saveAs: false
            });

            setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
            }, 60000);
        } catch (e) {
            URL.revokeObjectURL(objectUrl);
            throw e;
        }

    } catch (error) {
        console.error("Offscreen download failed:", error);
        throw error;
    }
}
