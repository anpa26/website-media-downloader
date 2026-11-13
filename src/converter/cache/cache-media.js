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



let _mediaCacheSettingValue = null;
if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['media-cache']) {
      _mediaCacheSettingValue = changes['media-cache'].newValue;
    }
  });
}

async function isMediaCacheSettingEnabled() {
  if (_mediaCacheSettingValue !== null) return _mediaCacheSettingValue === "1";
  try {
    const result = await browser.storage.local.get("media-cache");
    _mediaCacheSettingValue = result["media-cache"] ?? "0";
    return _mediaCacheSettingValue === "1";
  } catch (_) {
    return false;
  }
}

async function fetchWithCache(url, options = {}) {
  const isIncognito = (typeof browser !== 'undefined' && browser.extension && browser.extension.inIncognitoContext) || false;
  if (isIncognito || !(await isMediaCacheSettingEnabled())) {

    return spoofedFetch(url, options);
  }

  try {
    const db = await openCacheDB();
    const cachedItem = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (cachedItem) {
      let responseData;
      if (cachedItem.data) {
          responseData = cachedItem.data;
      } else {

          const chunks = [];
          const chunkTx = db.transaction([CHUNK_STORE_NAME], "readonly");
          const chunkStore = chunkTx.objectStore(CHUNK_STORE_NAME);
          const range = IDBKeyRange.bound([url, 0], [url, Infinity]);
          const cursorRequest = chunkStore.openCursor(range);

          await new Promise((resolveChunk, rejectChunk) => {
              cursorRequest.onsuccess = (e) => {
                  const cursor = e.target.result;
                  if (cursor) {
                      chunks.push(new Blob([cursor.value.data]));

                      if (chunks.length % 50 === 0) {
                          console.debug(`Reconstructing cached segments: ${chunks.length}...`);
                      }

                      cursor.continue();
                  } else {
                      resolveChunk();
                  }
              };
              cursorRequest.onerror = (e) => rejectChunk(e.target.error);
          });

          if (chunks.length > 0) {
              responseData = new Blob(chunks);
          }
      }

      if (responseData) {
        return new Response(responseData, {
          status: 200,
          statusText: "OK (Cached)",
          headers: {
            "Content-Type": cachedItem.mime || "application/octet-stream"
          }
        });
      }
    }

  } catch (e) {
    console.warn("Cache lookup failed/miss, fetching from network:", e);
  }

  return spoofedFetch(url, options);
}
