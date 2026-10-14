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

const OFFSCREEN_DB_NAME = "MediaCacheDB";
const OFFSCREEN_STORE_NAME = "network-cache";
const OFFSCREEN_CHUNK_STORE_NAME = "download-chunks";

function openOffscreenCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFSCREEN_DB_NAME, 3);
        request.onerror = (event) => reject(event.target.error || browser.i18n.getMessage("idbOpenError") || "IDB Open Error");
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startOffscreenAudioJob') {
        runPersistentAudioJob(message.jobId, { offscreen: true });
        sendResponse({ success: true });
        return;
    }
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
        const db = await openOffscreenCacheDB();

        const item = await new Promise((resolve, reject) => {
            const tx = db.transaction([OFFSCREEN_STORE_NAME], "readonly");
            const store = tx.objectStore(OFFSCREEN_STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!item) throw new Error(browser.i18n.getMessage("metadataNotFoundError") || "Download metadata not found in database");

        const chunks = [];
        await new Promise((resolve, reject) => {
            const tx = db.transaction([OFFSCREEN_CHUNK_STORE_NAME], "readonly");
            const store = tx.objectStore(OFFSCREEN_CHUNK_STORE_NAME);
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

        const mimeType = item.mime || finalBlob.type || "";
        filename = ensureFileExtension(filename, mimeType);

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
