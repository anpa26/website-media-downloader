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

let _cachedConverterDB = null;
function openCacheDB() {
  if (_cachedConverterDB) return Promise.resolve(_cachedConverterDB);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onerror = (event) => reject(event.target.error);
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
        _cachedConverterDB = null;
      };
      db.onclose = () => {
        _cachedConverterDB = null;
      };
      _cachedConverterDB = db;
      resolve(db);
    };
  });
}

async function storeCompletedDownloadBlob(cacheId, blob, mime) {
  const db = await openCacheDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).put({
      url: cacheId,
      mime: mime || blob.type || "application/octet-stream",
      data: blob,
      timestamp: Date.now()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Completed download cache write failed"));
    tx.onabort = () => reject(tx.error || new Error("Completed download cache write aborted"));
  });
}

async function storeConversionChunk(sessionId, index, data) {
  const db = await openCacheDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CHUNK_STORE_NAME], "readwrite");
    const store = tx.objectStore(CHUNK_STORE_NAME);
    const req = store.put({
      downloadId: sessionId,
      chunkIndex: index,
      data: data,
      timestamp: Date.now()
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getConversionChunks(sessionId) {
  const db = await openCacheDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
    const store = tx.objectStore(CHUNK_STORE_NAME);
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]);
    const cursorReq = store.openCursor(range);
    const chunks = [];
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        chunks.push(cursor.value.data);
        cursor.continue();
      } else {
        resolve(chunks);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

async function clearConversionChunks(sessionId) {
  try {
    const db = await openCacheDB();
    const tx = db.transaction([CHUNK_STORE_NAME], "readwrite");
    const store = tx.objectStore(CHUNK_STORE_NAME);
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]);
    store.delete(range);
  } catch (e) {
    console.warn("Failed to clear conversion chunks:", e);
  }
}

async function cleanupStaleConversionChunks(maxAgeMs = 6 * 60 * 60 * 1000) {
  try {
    const db = await openCacheDB();
    const cutoff = Date.now() - maxAgeMs;
    await new Promise((resolve, reject) => {
      const tx = db.transaction([CHUNK_STORE_NAME], "readwrite");
      const request = tx.objectStore(CHUNK_STORE_NAME).openCursor();
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        const value = cursor.value;
        if (/^(?:m3u8|mpd)_conv_/.test(String(value.downloadId)) && Number(value.timestamp || 0) < cutoff) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Cache cleanup aborted"));
    });
  } catch (error) { console.warn("Failed to clean stale conversion chunks:", error); }
}

cleanupStaleConversionChunks();
