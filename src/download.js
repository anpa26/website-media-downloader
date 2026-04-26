// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}

const urlParams = new URLSearchParams(window.location.search);
const downloadId = urlParams.get('id');
const targetUrl = urlParams.get('url');
const cacheKey = downloadId || targetUrl;
const filename = urlParams.get('filename') || 'Media File';

const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";
const CHUNK_STORE_NAME = "download-chunks";

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onerror = (event) => reject(event.target.error || "IDB Open Error");
        request.onblocked = () => {
            console.warn("IndexedDB blocked. Please close other tabs of this extension.");
            const title = document.getElementById('status-title');
            if (title) title.textContent = "Waiting for other tabs...";
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
        statusText.textContent = "Connecting to database...";
        const db = await openCacheDB();
        
        statusText.textContent = "Fetching file metadata...";
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(cacheKey);

        getRequest.onsuccess = async (event) => {
            try {
                const item = event.target.result;
                if (item) {
                    let blob;
                    if (item.data) {
                        // Legacy: full blob stored in memory/item.data
                        blob = item.data;
                    } else {
                        // Chunked storage: retrieve chunks from CHUNK_STORE_NAME
                        statusTitle.textContent = "Processing...";
                        statusText.textContent = "Reconstructing file from cache segments...";
                        
                        const chunks = [];
                        const chunkTx = db.transaction([CHUNK_STORE_NAME], "readonly");
                        const chunkStore = chunkTx.objectStore(CHUNK_STORE_NAME);
                        
                        const range = IDBKeyRange.bound([cacheKey, 0], [cacheKey, Infinity]);
                        const cursorRequest = chunkStore.openCursor(range);

                        await new Promise((resolveChunk, rejectChunk) => {
                            cursorRequest.onsuccess = (e) => {
                                const cursor = e.target.result;
                                if (cursor) {
                                    chunks.push(cursor.value.data);
                                    cursor.continue();
                                } else {
                                    resolveChunk();
                                }
                            };
                            cursorRequest.onerror = (e) => rejectChunk(e.target.error);
                        });

                        if (chunks.length === 0) {
                            throw new Error("No data chunks found in cache. The download may have failed or was cleared.");
                        }
                        
                        statusText.textContent = `Assembling ${chunks.length} segments...`;
                        blob = new Blob(chunks, { type: item.mime || "application/octet-stream" });
                    }

                    const objectUrl = URL.createObjectURL(blob);
                    
                    statusTitle.textContent = "Download Ready!";
                    saveButton.style.display = "inline-block";
                    saveButton.textContent = `Save ${filename}`;
                    statusText.textContent = "Your file is ready to be saved.";

                    const performDownload = () => {
                        const a = document.createElement("a");
                        a.href = objectUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        
                        statusText.textContent = "Saving to your device... This tab will close in a moment.";
                        saveButton.disabled = true;
                        saveButton.style.opacity = "0.5";

                        setTimeout(() => {
                            URL.revokeObjectURL(objectUrl);
                            try {
                                const delTx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
                                delTx.objectStore(STORE_NAME).delete(cacheKey);
                                const chunkRange = IDBKeyRange.bound([cacheKey, 0], [cacheKey, Infinity]);
                                delTx.objectStore(CHUNK_STORE_NAME).delete(chunkRange);
                            } catch (e) { console.warn("Cleanup failed:", e); }
                            window.close();
                        }, 8000);
                    };

                    saveButton.onclick = performDownload;
                    performDownload();
                } else {
                    statusTitle.textContent = "Error";
                    statusText.textContent = "File metadata not found in cache. It might have been cleared or the ID is incorrect.";
                    setTimeout(() => window.close(), 5000);
                }
            } catch (innerError) {
                statusTitle.textContent = "Processing Error";
                statusText.textContent = innerError.message;
            }
        };

        getRequest.onerror = (e) => {
            statusTitle.textContent = "Database Error";
            statusText.textContent = "Could not retrieve the file info from database.";
        };

    } catch (error) {
        statusTitle.textContent = "Unexpected Error";
        statusText.textContent = error.message;
        setTimeout(() => window.close(), 5000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (targetUrl) {
        triggerDownload();
    } else {
        window.close();
    }
});