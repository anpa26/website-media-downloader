/*
    offscreen.js - Hidden document handler for background downloads.
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
        request.onerror = (event) => reject(event.target.error || "IDB Open Error");
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'triggerOffscreenDownload') {
        const { id, filename } = message.data;
        handleOffscreenDownload(id, filename)
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }
});

async function handleOffscreenDownload(id, filename) {
    try {
        const db = await openCacheDB();
        
        // 1. Get metadata
        const item = await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!item) throw new Error("Download metadata not found in DB");

        // 2. Gather chunks
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
            
            // Cleanup after a long delay to allow the system download manager to pick it up
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
