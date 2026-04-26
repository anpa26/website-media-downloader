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

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = (event) => reject(event.target.error || "IDB Open Error");
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "url" });
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
        const db = await openCacheDB();
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(cacheKey);

        getRequest.onsuccess = (event) => {
            const item = event.target.result;
            if (item && item.data) {
                const blob = item.data;
                const objectUrl = URL.createObjectURL(blob);
                
                statusTitle.textContent = "Download Ready!";
                saveButton.style.display = "inline-block";
                saveButton.textContent = `Save ${filename}`;

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
                        const delTx = db.transaction([STORE_NAME], "readwrite");
                        delTx.objectStore(STORE_NAME).delete(cacheKey);
                        window.close();
                    }, 8000);
                };

                saveButton.onclick = performDownload;

                // Attempt auto-download
                performDownload();
            } else {
                statusTitle.textContent = "Error";
                statusText.textContent = "File not found in temporary cache.";
                setTimeout(() => window.close(), 3000);
            }
        };

        getRequest.onerror = (e) => {
            statusTitle.textContent = "Database Error";
            statusText.textContent = "Could not retrieve the file from cache.";
            window.close();
        };

    } catch (error) {
        statusTitle.textContent = "Unexpected Error";
        statusText.textContent = error.message;
        setTimeout(() => window.close(), 3000);
    }
}

if (targetUrl) {
    triggerDownload();
} else {
    window.close();
}