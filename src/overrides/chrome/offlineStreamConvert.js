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

const optionalLibraryLoads = new Map();

function ensureOptionalLibraryLoaded(src, globalName) {
  if (globalThis[globalName] !== undefined) return Promise.resolve();
  if (optionalLibraryLoads.has(src)) return optionalLibraryLoads.get(src);

  const load = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = browser.runtime.getURL(src);
    script.onload = () => globalThis[globalName] !== undefined
      ? resolve()
      : reject(new Error(`${src} loaded without exposing ${globalName}`));
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  }).catch(error => {
    optionalLibraryLoads.delete(src);
    throw error;
  });

  optionalLibraryLoads.set(src, load);
  return load;
}

const ensureClientZipLoaded = () => ensureOptionalLibraryLoaded('libraries/client-zip.js', 'downloadZip');
const ensureMuxJsLoaded = () => ensureOptionalLibraryLoaded('libraries/mux.js', 'muxjs');

function getHumanReadableSize(size) {
  const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
  let sizeInBytes = parseInt(size);
  if (isNaN(sizeInBytes)) return browser.i18n.getMessage("unknownSize") || "Unknown Size";
  let i = 0;
  while (sizeInBytes > 1024 && i < units.length - 1) { sizeInBytes /= 1024; i++; }
  return `${sizeInBytes.toFixed(2)} ${units[i]}`;
}

const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";
const CHUNK_STORE_NAME = "download-chunks";

function openCacheDB() {
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
    request.onsuccess = (event) => resolve(event.target.result);
  });
}

async function storeCompletedDownloadBlob(cacheId, blob, mime) {
  const db = await openCacheDB();
  try {
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
  } finally {
    db.close();
  }
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
    db.close();
  } catch (error) { console.warn("Failed to clean stale conversion chunks:", error); }
}

function waitForSegmentRetry(delay, checkCancel) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    if (!checkCancel) return;
    const interval = setInterval(() => {
      if (!checkCancel()) return;
      clearTimeout(timer); clearInterval(interval); reject(new Error("Cancelled"));
    }, Math.min(250, delay));
    setTimeout(() => clearInterval(interval), delay + 10);
  });
}

let segmentRetryNotBefore = 0;

function getSegmentRetryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay) && delay > 0) return Math.min(60000, delay);
  }
  return Math.min(15000, 750 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 500);
}

async function waitForStreamCooldown(checkCancel) {
  const delay = segmentRetryNotBefore - Date.now();
  if (delay > 0) await waitForSegmentRetry(delay, checkCancel);
}

async function waitForSegmentPause(pauseKey, checkCancel) {
  while (pauseKey && globalThis.activePauses?.has(pauseKey)) {
    if (checkCancel?.()) throw new Error("Cancelled");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function fetchSegmentWithRetry(url, options, checkCancel, pauseKey = null, maxAttempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (checkCancel?.()) throw new Error("Cancelled");
    try {
      await waitForSegmentPause(pauseKey, checkCancel);
      await waitForSegmentPause(pauseKey, checkCancel);
      await waitForStreamCooldown(checkCancel);
      const response = await fetchWithCache(url, options);
      if (response.ok) return response;
      const error = new Error(`HTTP ${response.status} while downloading segment`);
      error.status = response.status; error.response = response; throw error;
    } catch (error) {
      if (error?.message === "Cancelled" || error?.name === "AbortError" || checkCancel?.()) throw new Error("Cancelled");
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
      if (!retryable || attempt === maxAttempts) break;
      const delay = getSegmentRetryDelay(error.response, attempt);
      segmentRetryNotBefore = Math.max(segmentRetryNotBefore, Date.now() + delay);
      console.warn(`Segment retry ${attempt}/${maxAttempts - 1} in ${delay}ms: ${url}`, error);
      await waitForSegmentRetry(delay, checkCancel);
    }
  }
  throw lastError || new Error(`Failed to download segment: ${url}`);
}

async function fetchSegmentBufferWithRetry(url, options, checkCancel, pauseKey = null, maxAttempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (checkCancel?.()) throw new Error("Cancelled");
    try {
      await waitForStreamCooldown(checkCancel);
      const response = await fetchWithCache(url, options);
      if (!response.ok) { const error = new Error(`HTTP ${response.status} while downloading segment`); error.status = response.status; error.response = response; throw error; }
      if (!response.body) return await response.arrayBuffer();
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        await waitForSegmentPause(pauseKey, checkCancel);
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); total += value.byteLength;
      }
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return result.buffer;
    } catch (error) {
      if (error?.message === "Cancelled" || error?.name === "AbortError" || checkCancel?.()) throw new Error("Cancelled");
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
      if (!retryable || attempt === maxAttempts) break;
      const delay = getSegmentRetryDelay(error.response, attempt);
      segmentRetryNotBefore = Math.max(segmentRetryNotBefore, Date.now() + delay);
      console.warn(`Segment body retry ${attempt}/${maxAttempts - 1} in ${delay}ms: ${url}`, error);
      await waitForSegmentRetry(delay, checkCancel);
    }
  }
  throw lastError || new Error(`Failed to download segment: ${url}`);
}

cleanupStaleConversionChunks();

async function transmuxToMp4(tsBlobs, onProgress = null) {
  console.log("Starting transmuxing with mux.js. Segments count:", tsBlobs.length);
  
  await ensureMuxJsLoaded();
  if (typeof muxjs === 'undefined') {
    console.error("muxjs is NOT defined! Integration check failed.");
    return { blob: new Blob(tsBlobs, { type: "video/mp2t" }), ext: '.ts' };
  }

  return new Promise(async (resolve) => {
    try {
      await ensureOptionalLibraryLoaded('mp4_duration.js', 'mp4Duration');
      const transmuxer = new muxjs.mp4.Transmuxer();
      let durationFinalizer = null;
      const mp4Chunks = [];
      let initSegment = null;

      transmuxer.on('data', (event) => {
        
        if (event.initSegment) {
          if (!initSegment) {
            durationFinalizer = mp4Duration.createFinalizer(event.initSegment);
            initSegment = durationFinalizer.initSegment;
            mp4Chunks.push(initSegment);
            console.log("Init segment collected, size:", initSegment.byteLength);
          }
        }
        
        if (event.data) {
          durationFinalizer.addFragment(event.data);
          mp4Chunks.push(event.data);
        }
      });

      const inputChunkSize = 8 * 1024 * 1024 - ((8 * 1024 * 1024) % 188);
      const totalBytes = tsBlobs.reduce((sum, blob) => sum + Number(blob?.size || blob?.byteLength || 0), 0);
      let processedBytes = 0;
      const flushTransmuxer = () => {
        if (!transmuxer.transmuxPipeline_ || transmuxer.transmuxPipeline_.headOfPipeline) transmuxer.flush();
      };
      onProgress?.(0);
      for (const input of tsBlobs) {
        if (input instanceof Blob && input.size > inputChunkSize) {
          for (let offset = 0; offset < input.size; offset += inputChunkSize) {
            const part = input.slice(offset, Math.min(offset + inputChunkSize, input.size));
            transmuxer.push(new Uint8Array(await part.arrayBuffer()));
            flushTransmuxer();
            processedBytes += part.size;
            onProgress?.(totalBytes > 0 ? Math.min(99, processedBytes / totalBytes * 100) : 0);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } else {
          const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : new Uint8Array(input);
          transmuxer.push(bytes);
          flushTransmuxer();
          processedBytes += bytes.byteLength;
          onProgress?.(totalBytes > 0 ? Math.min(99, processedBytes / totalBytes * 100) : 0);
        }
      }
      flushTransmuxer();

      if (mp4Chunks.length === 0) {
        console.warn("Transmuxing produced no data. Returning original TS.");
        resolve({ blob: new Blob(tsBlobs, { type: "video/mp2t" }), ext: '.ts' });
      } else {
        durationFinalizer.finish();
        console.log("Transmuxing complete. Total chunks:", mp4Chunks.length);
        onProgress?.(100);
        resolve({ blob: new Blob(mp4Chunks, { type: 'video/mp4' }), ext: '.mp4' });
      }
    } catch (err) {
      console.error("Transmuxing error:", err);
      resolve({ blob: new Blob(tsBlobs, { type: "video/mp2t" }), ext: '.ts' });
    }
  });
}

async function spoofedFetch(url, options = {}) {
  try {
    const headers = await chrome.runtime.sendMessage({ action: 'getSpoofedHeaders', url: url });
    if (headers) {
      options.headers = options.headers || {};
      if (headers.cookie) options.headers['Cookie'] = headers.cookie;
      if (headers.referer) {
        options.headers['Referer'] = headers.referer;
        options.referrer = headers.referer;
      }
      if (headers.origin) options.headers['Origin'] = headers.origin;
      options.credentials = 'include';
    }
  } catch (e) {
    console.warn("Failed to get spoofed headers, falling back to normal fetch:", e);
  }
  return fetch(url, options);
}

async function fetchWithCache(url, options = {}) {
  const isIncognito = (typeof browser !== 'undefined' && browser.extension && browser.extension.inIncognitoContext) || false;
  if (isIncognito || (await browser.storage.local.get("media-cache").then((result) => result["media-cache"])) !== "1") {

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

class ParallelQueue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
      this.next();
    });
  }

  next() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.running++;
      task().finally(() => {
        this.running--;
        this.next();
      });
    }
  }
}

function updateProgressStatus(loadingBar, loaded, total) {
  if (!loadingBar || !loadingBar.parentNode) return;
  let statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
  if (!statusInfo) {
    statusInfo = document.createElement('div');
    statusInfo.className = 'download-status-info';
    loadingBar.parentNode.appendChild(statusInfo);
  }

  const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
  if (total > 0) {
    const totalMB = (total / (1024 * 1024)).toFixed(2);
    const percent = Math.round((loaded / total) * 100);
    const remainingMB = ((total - loaded) / (1024 * 1024)).toFixed(2);
    statusInfo.textContent = browser.i18n.getMessage("streamProgressWithSize", [loadedMB, totalMB, percent.toString(), remainingMB]) || `${loadedMB} MB / ${totalMB} MB (${percent}%) • ${remainingMB} MB remaining`;
    
    loadingBar.value = (loaded / total) * 100;
    loadingBar.removeAttribute('indeterminate');
  } else {
    statusInfo.textContent = browser.i18n.getMessage("streamProgressNoSize", [loadedMB]) || `${loadedMB} MB downloaded`;
    if (!loadingBar.value) loadingBar.setAttribute('indeterminate', '');
  }
}

function updateSegmentProgressStatus(loadingBar, processed, total) {
  if (!loadingBar || !loadingBar.parentNode) return;
  let statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
  if (!statusInfo) {
    statusInfo = document.createElement('div');
    statusInfo.className = 'download-status-info';
    loadingBar.parentNode.appendChild(statusInfo);
  }
  const percent = Math.round((processed / total) * 100);
  statusInfo.textContent = browser.i18n.getMessage("segmentProgress", [processed.toString(), total.toString(), percent.toString()]);
  
  loadingBar.value = (processed / total) * 100;
  loadingBar.removeAttribute('indeterminate');
}

class CloudUploadController {
    constructor() {
        this.paused = false;
        this.cancelled = false;
        this.onResume = null;
        this.xhr = null;
    }

    pause() {
        this.paused = true;
        if (this.xhr) {
            this.xhr.abort();
        }
    }

    resume() {
        this.paused = false;
        if (this.onResume) {
            this.onResume();
        }
    }

    cancel() {
        this.cancelled = true;
        if (this.xhr) {
            this.xhr.abort();
        }
    }
}

async function startDropboxStreamUpload(filename) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            if (!res.dropbox_token) {
                return reject(new Error("Dropbox token not found. Please login in settings."));
            }
            const token = res.dropbox_token;

            const initXhr = new XMLHttpRequest();
            initXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/start');
            initXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            initXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            initXhr.setRequestHeader('Dropbox-API-Arg', JSON.stringify({ close: false }));

            initXhr.onload = () => {
                if (initXhr.status === 200 || initXhr.status === 201) {
                    try {
                        const response = JSON.parse(initXhr.responseText);
                        resolve(response.session_id);
                    } catch (e) {
                        reject(new Error("Failed to parse Dropbox session ID"));
                    }
                } else if (initXhr.status === 401) {
                    reauthDropbox().then(() => {
                        startDropboxStreamUpload(filename).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox Stream Init Error: " + initXhr.statusText));
                }
            };
            initXhr.onerror = () => reject(new Error("Network error during Dropbox stream init"));
            initXhr.send();
        } catch (e) {
            reject(e);
        }
    });
}

async function appendDropboxStream(sessionId, offset, chunk) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            const token = res.dropbox_token;
            if (!token) return reject(new Error("Dropbox token missing"));

            const appendXhr = new XMLHttpRequest();
            appendXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/append_v2');
            appendXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            appendXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            appendXhr.setRequestHeader('Dropbox-API-Arg', JSON.stringify({
                cursor: {
                    session_id: sessionId,
                    offset: offset
                },
                close: false
            }));

            appendXhr.onload = () => {
                if (appendXhr.status === 200 || appendXhr.status === 201) {
                    resolve();
                } else if (appendXhr.status === 401) {
                    reauthDropbox().then(() => {
                        appendDropboxStream(sessionId, offset, chunk).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox append error: " + appendXhr.statusText));
                }
            };
            appendXhr.onerror = () => reject(new Error("Network error during Dropbox append"));
            appendXhr.send(chunk);
        } catch (e) {
            reject(e);
        }
    });
}

async function finishDropboxStream(sessionId, offset, filename) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            const token = res.dropbox_token;
            if (!token) return reject(new Error("Dropbox token missing"));

            const finishXhr = new XMLHttpRequest();
            finishXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/finish');
            finishXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            finishXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            const apiArgRaw = JSON.stringify({
                cursor: { session_id: sessionId, offset: offset },
                commit: {
                    path: "/" + filename.replace(/[/\\?%*:|"<>]/g, '-'),
                    mode: "add", autorename: true, mute: false
                }
            });
            const apiArg = apiArgRaw.replace(/[\u007f-\uffff]/g, function(c) { 
                return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
            });
            finishXhr.setRequestHeader('Dropbox-API-Arg', apiArg);

            finishXhr.onload = () => {
                if (finishXhr.status === 200 || finishXhr.status === 201) {
                    resolve();
                } else if (finishXhr.status === 401) {
                    reauthDropbox().then(() => {
                        finishDropboxStream(sessionId, offset, filename).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox finish error: " + finishXhr.statusText));
                }
            };
            finishXhr.onerror = () => reject(new Error("Network error during Dropbox finish"));
            finishXhr.send();
        } catch (e) {
            reject(e);
        }
    });
}

async function startGDriveStreamUpload(filename, totalSize, contentType) {
    const res = await browser.storage.local.get('gdrive_token');
    if (!res.gdrive_token) throw new Error("Google Drive token not found");
    const token = res.gdrive_token;

    const metadata = {
        name: filename,
        mimeType: contentType || 'application/octet-stream'
    };

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': contentType || 'application/octet-stream',
            'X-Upload-Content-Length': totalSize || '*'
        },
        body: JSON.stringify(metadata)
    });

    if (response.status !== 200 && response.status !== 201) {
        throw new Error("GDrive Session Init Error: " + response.statusText);
    }

    return response.headers.get('Location');
}

async function uploadStreamChunk(sessionUri, chunk, offset, totalSize) {
    const total = (totalSize !== undefined && totalSize !== null) ? totalSize : '*';
    let contentRange;
    if (chunk && chunk.length > 0) {
        const end = offset + chunk.length;
        contentRange = `bytes ${offset}-${end - 1}/${total}`;
    } else {
        contentRange = `bytes */${total}`;
        if (total === '*') return;
        chunk = new Uint8Array(0);
    }

    const response = await fetch(sessionUri, {
        method: 'PUT',
        headers: {
            'Content-Range': contentRange
        },
        body: chunk
    });

    if (response.status !== 308 && response.status !== 200 && response.status !== 201) {
        throw new Error("GDrive Chunk Upload Error: " + response.status);
    }
    
    return response;
}


async function reauthDropbox() {
    return new Promise((resolve, reject) => {
        try {
            const clientId = "gipboqpkook5oaj";
            let finalRedirectUri;
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
                finalRedirectUri = browser.identity.getRedirectURL();
            } else {
                const id = browser.runtime.id;
                if (id && id.includes('@')) {
                    finalRedirectUri = "https://" + encodeURIComponent(id) + ".extensions.allizom.org/";
                } else {
                    finalRedirectUri = "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
                }
            }
            const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;
            const authUrl = "https://www.dropbox.com/oauth2/authorize?client_id=" + clientId + "&response_type=token&redirect_uri=" + encodeURIComponent(finalRedirectUri);

            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                browser.identity.launchWebAuthFlow({ url: authUrl, interactive: false }).then(redirectUrl => {
                    if (redirectUrl) {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                        if (accessToken) {
                            browser.storage.local.set({ 'dropbox_token': accessToken }).then(() => resolve(accessToken));
                        } else {
                            reject(new Error("No access token found"));
                        }
                    } else reject(new Error("No redirect URL"));
                }).catch(e => reject(e));
            } else {
                let isResolved = false;
                let authTabId = null;
                const updatedListener = async (tabId, changeInfo, tab) => {
                    const urlString = changeInfo.url || tab.url;
                    if (urlString && urlString.includes(normalizedRedirectUri) && (urlString.includes('access_token=') || urlString.includes('error='))) {
                        if (!isResolved) {
                            isResolved = true;
                            browser.tabs.remove(tabId).catch(() => {});
                            cleanup();
                            const url = new URL(urlString);
                            const hashParams = new URLSearchParams(url.hash.substring(1));
                            const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                            if (accessToken) browser.storage.local.set({ 'dropbox_token': accessToken }).then(() => resolve(accessToken));
                            else reject(new Error("Failed to reauth Dropbox"));
                        }
                    }
                };
                const removedListener = (tabId) => {
                    if (authTabId && tabId === authTabId && !isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(new Error("Reauth tab closed"));
                    }
                };
                const cleanup = () => {
                    browser.tabs.onUpdated.removeListener(updatedListener);
                    browser.tabs.onRemoved.removeListener(removedListener);
                };
                browser.tabs.onUpdated.addListener(updatedListener);
                browser.tabs.onRemoved.addListener(removedListener);
                browser.tabs.create({ url: authUrl, active: false }).then(tab => { authTabId = tab.id; }).catch(e => {
                    if (!isResolved) { isResolved = true; cleanup(); reject(e); }
                });
            }
        } catch (e) { reject(e); }
    });
}

async function reauthGDrive() {
    return new Promise((resolve, reject) => {
        try {
            const clientId = "1042907477337-c8h27qniercjia05jqqafgvjao514n28.apps.googleusercontent.com";
            
            let finalRedirectUri;
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
                finalRedirectUri = browser.identity.getRedirectURL();
            } else {
                const id = browser.runtime.id;
                if (id && id.includes('@')) {
                    finalRedirectUri = `https://${encodeURIComponent(id)}.extensions.allizom.org/`;
                } else {
                    finalRedirectUri = "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
                }
            }

            const scope = encodeURIComponent("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email");
            const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;
            
            const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(finalRedirectUri)}&scope=${scope}&prompt=none`;
            
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                browser.identity.launchWebAuthFlow({
                    url: authUrl,
                    interactive: false
                }).then(async (redirectUrl) => {
                    if (redirectUrl) {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                        if (accessToken) {
                            await browser.storage.local.set({ 'gdrive_token': accessToken });
                            resolve(accessToken);
                        } else {
                            reject(new Error("No access token in redirect URL"));
                        }
                    } else {
                        reject(new Error("No redirect URL"));
                    }
                }).catch(e => {
                    reject(e);
                });
            } else {
                let isResolved = false;
                let authTabId = null;

                const updatedListener = async (tabId, changeInfo, tab) => {
                    const urlString = changeInfo.url || tab.url;
                    if (urlString && urlString.includes(normalizedRedirectUri) && (urlString.includes('access_token=') || urlString.includes('error='))) {
                        if (!isResolved) {
                            isResolved = true;
                            browser.tabs.remove(tabId).catch(() => {});
                            cleanup();
                            
                            const url = new URL(urlString);
                            const hashParams = new URLSearchParams(url.hash.substring(1));
                            const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                            
                            if (accessToken) {
                                await browser.storage.local.set({ 'gdrive_token': accessToken });
                                resolve(accessToken);
                            } else {
                                reject(new Error("Failed to reauth: " + (hashParams.get('error') || "No access token")));
                            }
                        }
                    }
                };

                const removedListener = (tabId) => {
                    if (authTabId && tabId === authTabId && !isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(new Error("Reauth tab closed"));
                    }
                };

                const cleanup = () => {
                    browser.tabs.onUpdated.removeListener(updatedListener);
                    browser.tabs.onRemoved.removeListener(removedListener);
                };

                browser.tabs.onUpdated.addListener(updatedListener);
                browser.tabs.onRemoved.addListener(removedListener);

                browser.tabs.create({ url: authUrl, active: false }).then(tab => {
                    authTabId = tab.id;
                }).catch(e => {
                    if (!isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(e);
                    }
                });
            }
        } catch (e) {
            reject(e);
        }
    });
}


function uploadToDropbox(blob, filename, onProgress, controller, isRetry = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            if (!res.dropbox_token) {
                return reject(new Error("Dropbox token not found. Please login in settings."));
            }
            const token = res.dropbox_token;

            const uploadUrl = 'https://content.dropboxapi.com/2/files/upload';
            const apiArgRaw = JSON.stringify({
                path: "/" + filename.replace(/[/\\?%*:|"<>]/g, '-'),
                mode: "add",
                autorename: true,
                mute: false
            });
            const apiArg = apiArgRaw.replace(/[\u007f-\uffff]/g, function(c) { 
                return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
            });

            const xhr = new XMLHttpRequest();
            if (controller) controller.xhr = xhr;
            xhr.open('POST', uploadUrl);
            xhr.setRequestHeader('Authorization', "Bearer " + token);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('Dropbox-API-Arg', apiArg);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && onProgress) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    onProgress(percent, event.loaded, event.total);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200 || xhr.status === 201) {
                    resolve();
                } else if (xhr.status === 401 && !isRetry) {
                    reauthDropbox().then(() => {
                        uploadToDropbox(blob, filename, onProgress, controller, true).then(resolve).catch(reject);
                    }).catch(() => {
                        reject(new Error("Dropbox session expired. Please re-login in settings."));
                    });
                } else {
                    reject(new Error("Dropbox Upload Error: " + xhr.statusText));
                }
            };

            xhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToDropbox(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                }
            };

            xhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToDropbox(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                } else {
                    reject(new Error("Network error during Dropbox upload"));
                }
            };

            xhr.send(blob);

        } catch (error) {
            reject(error);
        }
    });
}

function uploadToGDrive(blob, filename, onProgress, controller, isRetry = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('gdrive_token');
            if (!res.gdrive_token) {
                return reject(new Error(browser.i18n.getMessage("gdriveLoginRequired") || "Google Drive token not found. Please login in settings."));
            }
            const token = res.gdrive_token;

            const metadata = {
                name: filename,
                mimeType: blob.type || 'application/octet-stream'
            };

            const initXhr = new XMLHttpRequest();
            if (controller) controller.xhr = initXhr;
            initXhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable');
            initXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            initXhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
            initXhr.setRequestHeader('X-Upload-Content-Type', blob.type || 'application/octet-stream');
            initXhr.setRequestHeader('X-Upload-Content-Length', blob.size);

            initXhr.onload = () => {
                if (initXhr.status === 200 || initXhr.status === 201) {
                    const sessionUri = initXhr.getResponseHeader('Location');
                    if (sessionUri) {
                        uploadChunks(sessionUri, blob, onProgress, controller).then(resolve).catch(reject);
                    } else {
                        reject(new Error("Failed to get session URI for resumable upload"));
                    }
                } else if (initXhr.status === 401) {
                    if (!isRetry) {
                        reauthGDrive().then(() => {
                            uploadToGDrive(blob, filename, onProgress, controller, true).then(resolve).catch(reject);
                        }).catch(() => {
                            reject(new Error("Google Drive session expired. Please re-login in settings."));
                        });
                    } else {
                        reject(new Error("Google Drive session expired. Please re-login in settings."));
                    }
                } else {
                    reject(new Error("GDrive Init Error: " + initXhr.statusText));
                }
            };

            initXhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToGDrive(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                }
            };

            initXhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToGDrive(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                } else {
                    reject(new Error("Network error during GDrive init"));
                }
            };
            initXhr.send(JSON.stringify(metadata));

        } catch (error) {
            reject(error);
        }
    });
}

function uploadChunks(sessionUri, blob, onProgress, controller) {
    return new Promise((resolve, reject) => {
        const chunkSize = 1024 * 1024; // 1MB chunks
        let offset = 0;

        const uploadNextChunk = (retries = 3) => {
            if (controller && controller.cancelled) {
                reject(new Error("Upload cancelled"));
                return;
            }

            if (controller && controller.paused) {
                controller.onResume = () => {
                    controller.onResume = null;
                    uploadNextChunk();
                };
                return;
            }

            const end = Math.min(offset + chunkSize, blob.size);
            const chunk = blob.slice(offset, end);
            const contentRange = `bytes ${offset}-${end - 1}/${blob.size}`;

            const xhr = new XMLHttpRequest();
            if (controller) controller.xhr = xhr;
            xhr.open('PUT', sessionUri);
            xhr.setRequestHeader('Content-Range', contentRange);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    const totalUploaded = offset + e.loaded;
                    const percent = Math.round((totalUploaded / blob.size) * 100);
                    onProgress(percent, totalUploaded, blob.size);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 308) {
                    offset = end;
                    uploadNextChunk();
                } else if (xhr.status === 200 || xhr.status === 201) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        resolve(xhr.responseText);
                    }
                } else if (xhr.status >= 500 && xhr.status < 600) {
                    if (retries > 0) {
                        console.warn(`GDrive Chunk Error: ${xhr.status}, retrying... (${retries} left)`);
                        setTimeout(() => uploadNextChunk(retries - 1), 2000);
                    } else {
                        reject(new Error("GDrive Chunk Error: " + xhr.status + " " + xhr.statusText));
                    }
                } else {
                    reject(new Error("GDrive Chunk Error: " + xhr.status + " " + xhr.statusText));
                }
            };

            xhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadNextChunk();
                    };
                }
            };

            xhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {
                    // If we paused during an active chunk, set the resume hook to retry this chunk
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadNextChunk();
                    };
                } else {
                    if (retries > 0) {
                        console.warn(`Network error during GDrive chunk upload, retrying... (${retries} left)`);
                        setTimeout(() => uploadNextChunk(retries - 1), 2000);
                    } else {
                        reject(new Error("Network error during GDrive chunk upload"));
                    }
                }
            };
            xhr.send(chunk);
        };

        uploadNextChunk();
    });
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

async function finalizeDownload(blob, filename, downloadMethod, loadingBar = null, streamedToGDrive = false, streamedToDropbox = false) {
    if (blob) {
        filename = ensureFileExtension(filename, blob.type);
    }
    if (!blob) {
        if (streamedToGDrive) {
            if (loadingBar) {
                loadingBar.value = 100;
                loadingBar.removeAttribute('indeterminate');
                const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                if (statusInfo) {
                    statusInfo.textContent = browser.i18n.getMessage("uploadSuccessGDriveTitle") || `Upload Complete!`;
                }
            }
        }
        return;
    }

    const settings = await browser.storage.local.get(['save-to-gdrive', 'gdrive_token', 'save-to-dropbox', 'dropbox_token']);
    const gdriveEnabled = settings['save-to-gdrive'] === '1' && settings['gdrive_token'];
    const dropboxEnabled = settings['save-to-dropbox'] === '1' && settings['dropbox_token'];
    
    // Trigger local download first or early to preserve user gesture
    const objectUrl = URL.createObjectURL(blob);
    const triggerLocalDownload = async () => {
        return new Promise((resolve) => {
            const fallbackDownload = () => {
                const a = document.createElement("a");
                a.href = objectUrl;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    if (a.parentNode) document.body.removeChild(a);
                    resolve(true);
                }, 1000);
            };

            if (downloadMethod === "browser" && typeof browser !== 'undefined' && browser.downloads) {
                try {
                    browser.downloads.download({ url: objectUrl, filename: filename }, (downloadId) => {
                        if (browser.runtime.lastError) {
                            console.warn("browser.downloads.download failed:", browser.runtime.lastError.message);
                            fallbackDownload();
                        } else {
                            resolve(true);
                        }
                    });
                } catch (e) {
                    console.warn("browser.downloads.download sync failed, falling back to <a> click:", e);
                    fallbackDownload();
                }
            } else {
                fallbackDownload();
            }
        });
    };

    
    if (dropboxEnabled && !streamedToDropbox) {
        const controller = new CloudUploadController();
        try {
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ 
                    message: `Uploading ${filename} to Dropbox...`, 
                    placement: "top",
                    action: "Cancel",
                    onActionClick: () => controller.cancel()
                });
            }
            
            if (loadingBar) {
                loadingBar.max = 100;
                loadingBar.removeAttribute('indeterminate');
            }

            await uploadToDropbox(blob, filename, (percent) => {
                if (loadingBar) {
                    loadingBar.value = percent;
                    loadingBar.classList.add('uploading-phase');
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) {
                        statusInfo.textContent = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${percent}%)`;
                    }
                }
            }, controller);

            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ message: `Successfully uploaded ${filename} to Dropbox`, placement: "top" });
            }
            if (loadingBar) {
                const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                if (statusInfo) {
                    statusInfo.textContent = browser.i18n.getMessage("uploadSuccessGDriveTitle") || `Upload Complete!`;
                }
            }
        } catch (e) {
            console.error("Dropbox fallback upload failed:", e);
            if (e.message !== "Upload cancelled" && typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ message: `Dropbox Upload Failed: ${e.message}`, placement: "top" });
            }
            triggerLocalDownload();
        }
        return;
    }

    if (gdriveEnabled && !streamedToGDrive) {
        const controller = new CloudUploadController();
        try {
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ 
                    message: browser.i18n.getMessage("uploadingToGDrive", [filename]) || `Uploading ${filename} to Google Drive...`, 
                    placement: "top",
                    action: "Cancel",
                    onActionClick: () => controller.cancel()
                });
            }
            
            if (loadingBar) {
                loadingBar.max = 100;
                loadingBar.removeAttribute('indeterminate');
            }

            await uploadToGDrive(blob, filename, (percent) => {
                if (loadingBar) {
                    loadingBar.value = percent;
                    loadingBar.classList.add('uploading-phase');
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) {
                        statusInfo.textContent = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${percent}%)`;
                    }
                }
            }, controller);

            if (loadingBar) {
                loadingBar.value = 100;
                const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                if (statusInfo) {
                    statusInfo.textContent = browser.i18n.getMessage("uploadSuccessGDrive", [filename]) || `Successfully saved to Google Drive!`;
                }
            }

            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ message: browser.i18n.getMessage("uploadSuccessGDrive", [filename]) || `Successfully saved ${filename} to Google Drive!`, placement: "top" });
            }
        } catch (error) {
            if (error.message === "Upload cancelled") {
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    mdui.snackbar({ message: browser.i18n.getMessage("uploadCancelledTitle") || "Upload Cancelled", placement: "top" });
                }
            } else {
                console.error("GDrive upload failed, falling back to local download:", error);
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    mdui.snackbar({ message: (browser.i18n.getMessage("uploadFailedGDrive") || "Cloud upload failed") + `: ${error.message}. Downloading locally instead.`, placement: "top" });
                }
                await triggerLocalDownload();
                if (loadingBar) {
                    loadingBar.value = 100;
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) {
                        statusInfo.textContent = browser.i18n.getMessage("downloadComplete") || "Download Complete!";
                    }
                }
            }
        }
        return;
    }

    if (!streamedToGDrive && !streamedToDropbox) {
        await triggerLocalDownload();
        if (loadingBar) {
            loadingBar.value = 100;
            const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
            if (statusInfo) {
                statusInfo.textContent = browser.i18n.getMessage("downloadComplete") || "Download Complete!";
            }
        }
    }

    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
}

async function offlineAudioBufferToWav(buffer, onProgress, checkCancel = null) {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const channels = [];
  for (let i = 0; i < numOfChan; i++) {
    channels.push(buffer.getChannelData(i));
  }

  const workerCode = `
    self.onmessage = function(e) {
      const { channels, sampleRate } = e.data;
      const numOfChan = channels.length;
      const totalSamples = channels[0].length;
      const length = totalSamples * numOfChan * 2 + 44;
      const buffer_out = new ArrayBuffer(length);
      const view = new DataView(buffer_out);
      let pos = 0;

      function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
      function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

      setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
      setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
      setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan);
      setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
      setUint32(length - pos - 4);

      const batchSize = 100000;
      let offset = 0;
      let lastProgressReport = 0;

      while(offset < totalSamples) {
        let end = Math.min(offset + batchSize, totalSamples);
        for(; offset < end; offset++) {
          for(let i = 0; i < numOfChan; i++) {
            let sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
            view.setInt16(pos, sample, true);
            pos += 2;
          }
        }
        let currentProgress = offset / totalSamples;
        if (currentProgress - lastProgressReport >= 0.01 || offset >= totalSamples) {
          self.postMessage({ type: 'progress', progress: currentProgress });
          lastProgressReport = currentProgress;
        }
      }

      self.postMessage({ type: 'complete', buffer: buffer_out }, [buffer_out]);
    };
  `;

  return new Promise((resolve, reject) => {
    const worker = new Worker(browser.runtime.getURL('wav_worker.js'));
    let cancelInterval = null;

    if (checkCancel) {
      cancelInterval = setInterval(() => {
        if (checkCancel()) {
          if (cancelInterval) clearInterval(cancelInterval);
          worker.terminate();
          reject(new Error("Cancelled"));
        }
      }, 500);
    }

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        if (onProgress) onProgress(e.data.progress);
      } else if (e.data.type === 'complete') {
        if (cancelInterval) clearInterval(cancelInterval);
        worker.terminate();
        resolve(new Blob([e.data.buffer], { type: "audio/wav" }));
      }
    };

    worker.onerror = (err) => {
      if (cancelInterval) clearInterval(cancelInterval);
      worker.terminate();
      reject(new Error(err.message || `WAV worker failed (${err.filename || 'wav_worker.js'})`));
    };

    const buffers = channels.map(c => c.buffer);
    worker.postMessage({ channels, sampleRate }, buffers);
  });
}

async function offlineExtractAudioToWav(blob, loadingBar, checkCancel = null) {
    let statusInfo = null;
    if (loadingBar) {
        loadingBar.setAttribute('indeterminate', 'true');
        statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("decodingAudio") || "Decoding Audio...";
    }

    await new Promise(r => setTimeout(r, 200));

    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    try {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        if (loadingBar) {
            loadingBar.removeAttribute('indeterminate');
            loadingBar.max = 100;
        }

        const wavBlob = await offlineAudioBufferToWav(audioBuffer, (progress) => {
            if (checkCancel && checkCancel()) throw new Error("Cancelled");
            if (loadingBar) {
                const percent = Math.round(progress * 100);
                loadingBar.value = percent;
                if (statusInfo) statusInfo.textContent = (browser.i18n.getMessage("encodingProgress", [percent.toString()]) || `Encoding: ${percent}%`);
            }
        }, checkCancel);
        return wavBlob;
    } catch (e) {
        if (e.message === "Cancelled") throw e;
        if (e.message && e.message.toLowerCase().includes("unknown content type")) {
            throw new Error(browser.i18n.getMessage("audioExtractionFormatNotSupported") || "Your browser does not support audio extraction from this media format (typically .ts streams). Please download the full video and extract the audio manually.");
        }
        throw new Error("Failed to extract audio. " + e.message);
    } finally {
        try { audioCtx.close(); } catch(e) {}
    }
}

async function convertAudioToMp3IfEnabled(blob, filename, loadingBar = null, checkCancel = null) {
    const settings = await browser.storage.local.get('audio-to-mp3');
    if (settings['audio-to-mp3'] !== '1') return { blob, filename };

    const isWav = blob.type.includes('wav') || /\.wav$/i.test(filename);

    if (!isWav) return { blob, filename };

    let statusInfo = null;
    if (loadingBar) {
        statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
        if (statusInfo) statusInfo.textContent = "Converting to MP3...";
        loadingBar.setAttribute('indeterminate', 'true');
    }

    return new Promise((resolve, reject) => {
        const worker = new Worker('mp3_worker.js');
        let cancelInterval = null;

        if (checkCancel) {
            cancelInterval = setInterval(() => {
                if (checkCancel()) {
                    if (cancelInterval) clearInterval(cancelInterval);
                    worker.terminate();
                    reject(new Error("Cancelled"));
                }
            }, 500);
        }

        worker.onmessage = (e) => {
            if (e.data.type === 'progress') {
                if (loadingBar) {
                    loadingBar.removeAttribute('indeterminate');
                    const percent = Math.round(e.data.progress * 100);
                    loadingBar.value = percent;
                    if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("convertingToMp3Progress", [percent.toString()]) || `Converting to MP3: ${percent}%`;
                }
            } else if (e.data.success) {
                resolve({ blob: e.data.blob, filename: e.data.filename });
            } else {
                console.warn("MP3 Conversion failed, using original:", e.data.error);
                resolve({ blob, filename });
            }
            if (e.data.success !== undefined) {
                if (cancelInterval) clearInterval(cancelInterval);
                worker.terminate();
            }
        };
        worker.onerror = (err) => {
            console.warn("MP3 Worker error, using original:", err);
            resolve({ blob, filename });
            if (cancelInterval) clearInterval(cancelInterval);
            worker.terminate();
        };

        blob.arrayBuffer().then(async buffer => {
            if (checkCancel && checkCancel()) {
                if (cancelInterval) clearInterval(cancelInterval);
                worker.terminate();
                return reject(new Error("Cancelled"));
            }
            const bitrateRes = await browser.storage.local.get('mp3-bitrate');
            const bitrate = bitrateRes['mp3-bitrate'] || '320';
            worker.postMessage({ id: Date.now(), data: buffer, filename, bitrate });
        }).catch(err => {
            console.error("Failed to read blob for MP3 conversion:", err);
            resolve({ blob, filename });
            if (cancelInterval) clearInterval(cancelInterval);
            worker.terminate();
        });
    });
}
async function downloadM3U8Offline(m3u8Url, headers, downloadMethod, loadingBar, request, customFilename = null, audioOnly = false, selectedQuality = null) {
  const checkCancel = () => window.activeCancellations && window.activeCancellations.has(m3u8Url);

  const getText = async (url) => {
    const fetchOptions = {
      headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
      method: request.method,
      referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value || "",
    };

    if (request.method !== 'GET' && request.requestBody) {
      if (request.requestBody.type === 'formData') {
        const formData = new FormData();
        for (const key in request.requestBody.data) {
          request.requestBody.data[key].forEach(val => formData.append(key, val));
        }
        fetchOptions.body = formData;
      } else if (request.requestBody.type === 'base64') {
        const bin = atob(request.requestBody.data);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        fetchOptions.body = u;
      }
    }

    const res = await fetchSegmentWithRetry(url, fetchOptions, checkCancel, m3u8Url);
    return res.text();
  };

  const m3u8Text = await getText(m3u8Url);
  const isMasterPlaylist = m3u8Text.includes("#EXT-X-STREAM-INF");

  let videoUrl = m3u8Url;
  let audioUrl = null;

  if (isMasterPlaylist) {
    const lines = m3u8Text.split("\n");
    const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);

    const selectedVariant = await selectStreamVariant(lines, base, {
      headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
      referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value,
      method: request.method
    }, selectedQuality);
    videoUrl = selectedVariant.uri;

    const audioLine = lines.find(l => l.startsWith("#EXT-X-MEDIA:") && l.includes('TYPE=AUDIO'));
    if (audioLine) {
      const uriMatch = audioLine.match(/URI="([^"]+)"/);
      if (uriMatch) {
        const audioUri = uriMatch[1];
        audioUrl = audioUri.startsWith("http") ? audioUri : base + audioUri;
      }
    }
  }
  if (audioUrl) {
    
    const snackbar = document.createElement('mdui-snackbar');
    snackbar.setAttribute('open', true);
    snackbar.setAttribute('timeout', 10000);
    snackbar.textContent = browser.i18n.getMessage("splitDownloadWarningSnackbar")
    document.body.appendChild(snackbar);
    snackbar.addEventListener('close', () => {
      snackbar.remove();
    });
  }

  async function downloadSegments(playlistUrl, isAudio = false, customFilename = null) {
    if (loadingBar) {
        loadingBar.max = 100;
        loadingBar.value = 0;
    }
    const playlistText = await getText(playlistUrl);
    const rawLines = playlistText.split(/\r?\n/);

    const sessionId = "m3u8_conv_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
    const fetchOpts = {
      headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
      referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value,
      method: request.method
    };

    let mediaSeq = 0;
    let hasDRM, drmAbort = false;
    for (const l of rawLines) {
      if (/^#EXT-X-KEY:/i.test(l)) {
        const method = (l.match(/METHOD=([^,]*)/) || [null, null])[1];
        if (method && method.toUpperCase().includes("SAMPLE-AES")) {
          hasDRM = true;
          break;
        }
      }
      const m = l.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/);
      if (m) { mediaSeq = parseInt(m[1], 10); break; }
    }

    if (hasDRM) {
      await mdui.confirm({
        headline: browser.i18n.getMessage("drmWarningTitle"),
        description: browser.i18n.getMessage("drmWarningDescription"),
        confirmText: browser.i18n.getMessage("drmWarningConntinueButton"),
        cancelText: browser.i18n.getMessage("drmWarningCancelButton"),
        onCancel: () => { drmAbort = true; },
      });
    }

    if (drmAbort) {
      throw new Error(browser.i18n.getMessage("drmAbortedError") || "Download aborted by user due to DRM protection.");
    }

    const items = []; 
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXT-X-KEY')) {
        
        items.push({ type: 'key', raw: line });
      } else if (line.startsWith('#EXT-X-MAP')) {
        items.push({ type: 'map', raw: line });
      } else if (line.startsWith('#')) {
        
        continue;
      } else {
        
        items.push({ type: 'segment', uri: new URL(line, playlistUrl).href, rawUri: line });
      }
    }

    const segCount = items.filter(it => it.type === 'segment').length;

    let container = null; 

    let currentKeyBuffer = null;   
    let currentKeyUri = null;      
    let currentKeyIV = null;       

    let processedSegmentIndex = 0; 

    function makeSequenceIV(seq) {
      const iv = new Uint8Array(16);
      const dv = new DataView(iv.buffer);
      
      if (typeof dv.setBigUint64 === 'function') {
        try {
          dv.setBigUint64(8, BigInt(seq), false);
        } catch (e) {

          const high = Math.floor(seq / 0x100000000);
          const low = seq >>> 0;
          dv.setUint32(8, high, false);
          dv.setUint32(12, low, false);
        }
      } else {
        const high = Math.floor(seq / 0x100000000);
        const low = seq >>> 0;
        dv.setUint32(8, high, false);
        dv.setUint32(12, low, false);
      }
      return iv;
    }

    async function fetchAndDecodeKey(keyHref, fetchOpts) {
      const ab = await fetchSegmentBufferWithRetry(keyHref, fetchOpts, checkCancel, m3u8Url);

      if (ab.byteLength === 16) return ab;

      const text = new TextDecoder().decode(ab).trim().replace(/^"(.*)"$/, '$1').trim();

      if (/^[0-9a-fA-F]{32}$/.test(text)) {
        const u = new Uint8Array(16);
        for (let i = 0; i < 16; i++) u[i] = parseInt(text.substr(i * 2, 2), 16);
        return u.buffer;
      }

      if (text.length >= 22 && text.length <= 24) {
        try {
          const bin = atob(text);
          const u = Uint8Array.from(bin, c => c.charCodeAt(0));
          if (u.byteLength === 16) return u.buffer;
        } catch (e) { }
      }

      throw new Error(`Invalid key length: ${ab.byteLength} bytes. Expected 16.`);
    }

    async function decryptSegment(encryptedBuffer, keyBuffer, iv) {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBuffer,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );

      try {
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-CBC", iv },
          cryptoKey,
          encryptedBuffer
        );
        return new Uint8Array(decrypted);
      } catch (e) {

        throw new Error(`WebCrypto Decrypt Failed. Check if the key/IV is correct for this segment.`);
      }
    }

    const settings = await browser.storage.local.get(['speed-boost', 'connections', 'gdrive-stream', 'gdrive_token', 'stream-to-mp4', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token']);
    const isParallel = settings['speed-boost'] === '1';
    const concurrency = isParallel ? parseInt(settings['connections'] || '4', 10) : 1;
    const queue = new ParallelQueue(concurrency);

    const gdriveStreamSettings = await browser.storage.local.get('save-to-gdrive');
    const isGdriveStream = gdriveStreamSettings['save-to-gdrive'] === '1' && settings['gdrive-stream'] === '1' && settings['gdrive_token'];
    const isDropboxStream = settings['save-to-dropbox'] === '1' && settings['dropbox-stream'] === '1' && settings['dropbox_token'];
    let gdriveSessionUri = null;
    let dropboxSessionId = null;
    let dropboxOffset = 0;
    let useDropboxStream = isDropboxStream;
    let currentUploadOffset = 0;

    if (isDropboxStream) {
        try {
            const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(m3u8Url);
            const streamExt = settings['stream-to-mp4'] !== '0' ? '.mp4' : '.ts';
            const uploadFilename = isAudio ? `${baseFileName}_audio.mp4` : `${baseFileName}${streamExt}`;
            dropboxSessionId = await startDropboxStreamUpload(uploadFilename);
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ 
                    message: browser.i18n.getMessage("uploadingToDropbox", [uploadFilename]) || `Uploading ${uploadFilename} to Dropbox...`, 
                    placement: "top"
                });
            }
        } catch(e) { console.error("Failed to start Dropbox stream upload for M3U8:", e); }
    }
    if (isGdriveStream) {
        try {
            const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(m3u8Url);
            const streamExt = settings['stream-to-mp4'] !== '0' ? '.mp4' : '.ts';
            const uploadFilename = isAudio ? `${baseFileName}_audio.mp4` : `${baseFileName}${streamExt}`;
            const mimeType = isAudio ? 'audio/mp4' : (streamExt === '.mp4' ? 'video/mp4' : 'video/mp2t');
            
            gdriveSessionUri = await startGDriveStreamUpload(uploadFilename, null, mimeType);
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ 
                    message: browser.i18n.getMessage("uploadingToGDrive", [uploadFilename]) || `Uploading ${uploadFilename} to Google Drive...`, 
                    placement: "top"
                });
            }
        } catch (e) {
            console.error("Failed to start GDrive stream upload for M3U8:", e);
        }
    }

    let transmuxer = null;
    const transmuxedOutputQueue = [];
    if (settings['stream-to-mp4'] !== '0') {
        await ensureMuxJsLoaded();
    }
    if ((gdriveSessionUri || dropboxSessionId) && settings['stream-to-mp4'] !== '0' && typeof muxjs !== 'undefined') {
        await ensureOptionalLibraryLoaded('mp4_duration.js', 'mp4Duration');
        // Cloud uploads cannot rewrite their first bytes after they have been sent.
        // The selected media playlist describes the segments this download uploads.
        const playlistDuration = rawLines.reduce((sum, line) => {
            const match = line.trim().match(/^#EXTINF:([0-9.]+)/i);
            return sum + (match ? Number(match[1]) || 0 : 0);
        }, 0);
        let uploadedInitSegment = false;
        transmuxer = new muxjs.mp4.Transmuxer();
        transmuxer.on('data', (event) => {
            if (event.initSegment && !uploadedInitSegment) {
                transmuxedOutputQueue.push(mp4Duration.setDuration(event.initSegment, playlistDuration));
                uploadedInitSegment = true;
            }
            if (event.data) transmuxedOutputQueue.push(event.data);
        });
    }

    let nextUploadIndex = 0;
    const pendingUploads = new Map();
    let isUploadingInProgress = false;
    let uploadBuffer = [];
    let uploadBufferSize = 0;
    const GDRIVE_CHUNK_UNIT = 256 * 1024;

    async function tryUploadNext(isFinal = false) {
        if (isUploadingInProgress || (!gdriveSessionUri && !dropboxSessionId)) return;
        isUploadingInProgress = true;
        
        while (pendingUploads.has(nextUploadIndex) || (isFinal && uploadBufferSize > 0)) {
            if (pendingUploads.has(nextUploadIndex)) {
                const data = pendingUploads.get(nextUploadIndex);
                pendingUploads.delete(nextUploadIndex);
                
                if (transmuxer) {
                    transmuxer.push(data);
                    if (transmuxer.transmuxPipeline_ && transmuxer.transmuxPipeline_.headOfPipeline) {
                        transmuxer.flush();
                    }
                    while (transmuxedOutputQueue.length > 0) {
                        const chunk = transmuxedOutputQueue.shift();
                        uploadBuffer.push(chunk);
                        uploadBufferSize += chunk.byteLength;
                    }
                } else {
                    uploadBuffer.push(data);
                    uploadBufferSize += data.byteLength;
                }
                nextUploadIndex++;
            }

            // Flush logic
            if (uploadBufferSize >= GDRIVE_CHUNK_UNIT || (isFinal && uploadBufferSize > 0)) {
                let dataToUpload;
                let uploadSize;

                const fullData = new Uint8Array(uploadBufferSize);
                let pos = 0;
                for (const b of uploadBuffer) {
                    fullData.set(b, pos);
                    pos += b.byteLength;
                }

                if (isFinal) {
                    dataToUpload = fullData;
                    uploadSize = uploadBufferSize;
                    uploadBuffer = [];
                    uploadBufferSize = 0;
                } else {
                    uploadSize = Math.floor(uploadBufferSize / GDRIVE_CHUNK_UNIT) * GDRIVE_CHUNK_UNIT;
                    if (uploadSize === 0) {
                        if (!pendingUploads.has(nextUploadIndex)) break;
                        continue;
                    }
                    dataToUpload = fullData.slice(0, uploadSize);
                    const remainder = fullData.slice(uploadSize);
                    uploadBuffer = [remainder];
                    uploadBufferSize = remainder.byteLength;
                }

                let retries = 3;
                let success = false;
                while (retries > 0 && !success) {
                    try {
                        if (gdriveSessionUri) {
                            await uploadStreamChunk(gdriveSessionUri, dataToUpload, currentUploadOffset, isFinal ? (currentUploadOffset + dataToUpload.byteLength) : undefined);
                        }
                        if (dropboxSessionId) {
                            await appendDropboxStream(dropboxSessionId, dropboxOffset, dataToUpload);
                        }
                        if (gdriveSessionUri) currentUploadOffset += uploadSize;
                        if (dropboxSessionId) dropboxOffset += uploadSize;
                        success = true;
                    } catch (e) {
                        retries--;
                        console.warn(`Cloud HLS chunk upload retry (${3-retries}):`, e);
                        if (retries === 0) {
                            gdriveSessionUri = null;
                            dropboxSessionId = null;
                            isUploadingInProgress = false;
                            return;
                        }
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            } else {
                break;
            }
        }
        isUploadingInProgress = false;
    }

    let currentMap = null;

    const segmentsToDownload = [];
    let segmentSeqCounter = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];

      if (it.type === 'key') {
        const line = it.raw;
        const method = (line.match(/METHOD=([^,]*)/) || [null, null])[1];
        const uriMatch = line.match(/URI="([^"]+)"/);
        const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/);

        if (!method || method === 'NONE') {
          currentKeyBuffer = null;
          currentKeyUri = null;
          currentKeyIV = null;
        } else if (method === 'AES-128') {
          if (uriMatch) {
            const keyHref = new URL(uriMatch[1], playlistUrl).href;
            if (ivMatch) {
              const ivHex = ivMatch[1];
              currentKeyIV = Uint8Array.from(ivHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
            } else {
              currentKeyIV = null;
            }

            if (keyHref !== currentKeyUri) {
              currentKeyBuffer = await fetchAndDecodeKey(keyHref, fetchOpts);
              currentKeyUri = keyHref;
            }
          }
        }
        continue;
      }

      if (it.type === 'map') {
        const mapUriMatch = it.raw.match(/URI="([^"]+)"/);
        if (mapUriMatch) {
          const mapHref = new URL(mapUriMatch[1], playlistUrl).href;
          let mapData = new Uint8Array(await fetchSegmentBufferWithRetry(mapHref, fetchOpts, checkCancel, m3u8Url));

          if (currentKeyBuffer) {
            const iv = currentKeyIV ? currentKeyIV : makeSequenceIV(0);
            mapData = await decryptSegment(mapData, currentKeyBuffer, iv);
          }
          currentMap = mapData;
        }
        continue;
      }

      if (it.type === 'segment') {
        segmentsToDownload.push({
          uri: it.uri,
          index: segmentSeqCounter,
          key: currentKeyBuffer ? { buffer: currentKeyBuffer, iv: currentKeyIV } : null,
          map: currentMap
        });
        segmentSeqCounter++;

        currentMap = null;
      }
    }

    const downloadTask = async (seg) => {
      if (window.activeCancellations && window.activeCancellations.has(m3u8Url)) {
        throw new Error("Cancelled");
      }
      try {
        let arr = new Uint8Array(await fetchSegmentBufferWithRetry(seg.uri, fetchOpts, checkCancel, m3u8Url));

        if (seg.key) {
          const seq = mediaSeq + seg.index + 1;
          const iv = seg.key.iv ? seg.key.iv : makeSequenceIV(seq);
          arr = await decryptSegment(arr, seg.key.buffer, iv);
        }

        if (seg.map) {
          const combined = new Uint8Array(seg.map.byteLength + arr.byteLength);
          combined.set(seg.map, 0);
          combined.set(arr, seg.map.byteLength);
          arr = combined;
        }

        if (gdriveSessionUri || dropboxSessionId) {
            pendingUploads.set(seg.index, arr);
            await tryUploadNext();
        }

        await storeConversionChunk(sessionId, seg.index, new Blob([arr]));

        if (loadingBar) {
          globalProcessedSegments++;
          loadingBar.removeAttribute('indeterminate');
          const progressPercent = (globalProcessedSegments / globalTotalSegments) * 100;
          loadingBar.value = progressPercent;
          updateSegmentProgressStatus(loadingBar, globalProcessedSegments, globalTotalSegments);
          
          if (gdriveSessionUri || dropboxSessionId) {
             const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
             if (statusInfo) {
               const percent = Math.round(progressPercent);
               statusInfo.textContent = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${percent}%)`;
             }
          }
        }
      } catch (e) {
        console.error(`Segment download failed: ${seg.uri}`, e);
        throw e;
      }
    };

    const tasks = segmentsToDownload.map(seg => queue.add(() => downloadTask(seg)));
    try {
      await Promise.all(tasks);
      
      // Flush any remaining data in the buffer and finalize
      if (gdriveSessionUri || dropboxSessionId) {
          await tryUploadNext(true);
      }

      // Finalize GDrive/Dropbox upload if active
      if (gdriveSessionUri || dropboxSessionId) {
          try {
              const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(m3u8Url);
              const streamExt = settings['stream-to-mp4'] !== '0' ? '.mp4' : '.ts';
              const uploadFilename = isAudio ? `${baseFileName}_audio.mp4` : `${baseFileName}${streamExt}`;
              
              if (gdriveSessionUri) {
                  await uploadStreamChunk(gdriveSessionUri, new Uint8Array(0), currentUploadOffset, currentUploadOffset);
                  if (typeof mdui !== 'undefined' && mdui.snackbar) {
                      mdui.snackbar({ message: browser.i18n.getMessage("uploadSuccessGDrive", [uploadFilename]) || `Successfully saved ${uploadFilename} to Google Drive!`, placement: "top" });
                  }
              }
              if (dropboxSessionId) {
                  await finishDropboxStream(dropboxSessionId, dropboxOffset, uploadFilename);
                  if (typeof mdui !== 'undefined' && mdui.snackbar) {
                      mdui.snackbar({ message: browser.i18n.getMessage("uploadSuccessDropbox", [uploadFilename]) || `Successfully saved ${uploadFilename} to Dropbox!`, placement: "top" });
                  }
              }
          } catch (e) {
              console.error("Failed to finalize Cloud stream upload:", e);
          }
      }

      const filteredChunks = await getConversionChunks(sessionId);

      if (filteredChunks.length > 0) {
        const firstChunk = filteredChunks[0];
        const firstArr = new Uint8Array(await firstChunk.slice(0, 32).arrayBuffer());
        if (firstArr[0] === 0x47) container = 'ts';
        else {
          
          const hex = Array.from(firstArr).map(b => b.toString(16).padStart(2, '0')).join('');
          if (hex.includes('66747970') || hex.includes('73747970')) container = 'fmp4';
        }
      }

      let finalResult;
      if (container === 'fmp4') {
        finalResult = { blob: new Blob(filteredChunks, { type: "video/mp4" }), ext: '.mp4' };
      } else {
        const convertPref = await browser.storage.local.get('stream-to-mp4');
        const shouldConvert = convertPref['stream-to-mp4'] !== '0';
        if (shouldConvert) {
          if (loadingBar) {
            const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
            if (statusInfo && !gdriveSessionUri) {
              statusInfo.textContent = browser.i18n.getMessage("downloadTransmuxing") || "Converting to MP4...";
            }
          }
          try {
            const result = await transmuxToMp4(filteredChunks);
            if (!result?.blob?.size || result.ext !== '.mp4') {
              throw new Error('MP4 conversion produced no valid MP4 output');
            }
            finalResult = { blob: result.blob, ext: '.mp4' };
          } catch (conversionError) {
            console.warn('MP4 conversion failed; saving the original stream as TS:', conversionError);
            finalResult = { blob: new Blob(filteredChunks, { type: "video/mp2t" }), ext: '.ts' };
            if (loadingBar) {
              const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
              if (statusInfo && !gdriveSessionUri) {
                statusInfo.textContent = browser.i18n.getMessage('streamConversionFallbackTs') || 'MP4 conversion failed. Saving as TS...';
              }
            }
          }
        } else {
          finalResult = { blob: new Blob(filteredChunks, { type: "video/mp2t" }), ext: '.ts' };
        }
      }
      if (loadingBar) {
        loadingBar.value = 100;
        const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
        if (statusInfo) {
          statusInfo.textContent = (gdriveSessionUri || dropboxSessionId) 
            ? (browser.i18n.getMessage("uploadSuccessGDriveTitle") || "Upload Complete!")
            : (browser.i18n.getMessage("downloadComplete") || "Download Complete!");
        }
      }
      return { ...finalResult, streamed: !!gdriveSessionUri || !!dropboxSessionId, streamedToGDrive: !!gdriveSessionUri, streamedToDropbox: !!dropboxSessionId };
    } finally {
      await clearConversionChunks(sessionId);
    }
  };

  async function countSegments(playlistUrl) {
    const text = await getText(playlistUrl);
    return text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).length;
  }

  let globalTotalSegments = 0;
  let globalProcessedSegments = 0;

  if (audioOnly) {
    if (!audioUrl) {

       globalTotalSegments = await countSegments(videoUrl);
       const { blob, streamed } = await downloadSegments(videoUrl, true, customFilename);

       const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(videoUrl);
       let finalAudioBlob = blob;
       let finalAudioFileName = customFilename || `${baseFileName}.mp3`;

       let wavBlob;
       try {
           wavBlob = await offlineExtractAudioToWav(blob, loadingBar, checkCancel);
       } catch (e) {
           console.error("Failed to decode to wav:", e);
           throw e;
       }

       const converted = await convertAudioToMp3IfEnabled(wavBlob, finalAudioFileName, loadingBar, checkCancel);
       finalAudioBlob = converted.blob;
       finalAudioFileName = converted.filename;

       // Extracted audio is a new file (WAV/MP3), so we must upload it if GDrive is enabled.
       await finalizeDownload(finalAudioBlob, finalAudioFileName, downloadMethod, loadingBar, false, false);

       return { blob: finalAudioBlob, streamed: false };
    }
    globalTotalSegments = await countSegments(audioUrl);
  } else {

    globalTotalSegments += await countSegments(videoUrl);
    if (audioUrl) {
      globalTotalSegments += await countSegments(audioUrl);
    }
  }

  let videoBlob, ext, videoStreamed, videoStreamedToGDrive, videoStreamedToDropbox;
  if (!audioOnly) {
    const videoResult = await downloadSegments(videoUrl, false, customFilename);
    videoBlob = videoResult.blob;
    ext = videoResult.ext;
    videoStreamed = videoResult.streamed;
    videoStreamedToGDrive = videoResult.streamedToGDrive;
    videoStreamedToDropbox = videoResult.streamedToDropbox;

    const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(m3u8Url);
    const videoBlobUrl = URL.createObjectURL(videoBlob);

    await finalizeDownload(videoBlob, audioUrl ? `${baseFileName}_video${ext}` : `${baseFileName}${ext}`, downloadMethod, loadingBar, videoStreamedToGDrive, videoStreamedToDropbox);

    URL.revokeObjectURL(videoBlobUrl);
  }

  if (audioUrl) {
    const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(m3u8Url);
    loadingBar.setAttribute('aria-label', browser.i18n.getMessage("downloadingAudioSnackbar"));
    const snackbar = document.createElement('mdui-snackbar');
    snackbar.setAttribute('open', true);
    snackbar.setAttribute('timeout', 10000);
    snackbar.textContent = browser.i18n.getMessage("downloadingAudioSnackbar")
    document.body.appendChild(snackbar);
    snackbar.addEventListener('close', () => {
      snackbar.remove();
    });
    const { blob: audioBlob, streamed: audioStreamed, streamedToGDrive: audioStreamedToGDrive, streamedToDropbox: audioStreamedToDropbox } = await downloadSegments(audioUrl, true, customFilename);

    let finalAudioBlob = audioBlob;
    let finalAudioFileName = audioOnly ? (customFilename || `${baseFileName}.mp3`) : `${baseFileName}_audio.mp4`;
    let audioConverted = false;

    if (audioOnly) {
        let wavBlob;
        try {
            wavBlob = await offlineExtractAudioToWav(audioBlob, loadingBar, checkCancel);
            audioConverted = true;
        } catch (e) {
            console.error("Failed to decode to wav:", e);
            throw e;
        }

        const converted = await convertAudioToMp3IfEnabled(wavBlob, finalAudioFileName, loadingBar, checkCancel);
        finalAudioBlob = converted.blob;        finalAudioFileName = converted.filename;
    }

    await finalizeDownload(finalAudioBlob, finalAudioFileName, downloadMethod, loadingBar, audioConverted ? false : audioStreamedToGDrive, audioConverted ? false : audioStreamedToDropbox);

    if (audioOnly) {
        showDialog(browser.i18n.getMessage("audioExtractionSuccess", [finalAudioFileName]), browser.i18n.getMessage("successTitle"));
        return { blob: finalAudioBlob, streamed: audioConverted ? false : audioStreamed };
    } else {
        const audioBlobUrl = URL.createObjectURL(audioBlob);
        showDialog(browser.i18n.getMessage("splitAudioVideoDownloadCompleteDescription", [new Option(baseFileName).innerHTML, ext]), browser.i18n.getMessage("splitAudioVideoDownloadCompleteTitle"), { error: browser.i18n.getMessage("splitAudioVideoDownloadCompleteSuccess", [baseFileName]), urls: { video: URL.createObjectURL(videoBlob), audio: audioBlobUrl, m3u8: m3u8Url }, request: request, downloadMethod: downloadMethod });
    }
    return;
  }
}

async function selectStreamVariant(playlistLines, baseUrl, options = {}, selectedQuality = null) {
  const variants = [];

  for (let i = 0; i < playlistLines.length; i++) {
    if (playlistLines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bwMatch = playlistLines[i].match(/BANDWIDTH=(\d+)/);
      const resMatch = playlistLines[i].match(/RESOLUTION=(\d+x\d+)/);
      const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
      const resolution = resMatch ? resMatch[1] : "unknown";
      const uri = playlistLines[i + 1];
        variants.push({
        bandwidth,
        resolution,
        uri: uri.startsWith("http") ? uri : baseUrl + uri
      });
    }
  }

  if (variants.length === 0) return null;

  const urlParams = new URLSearchParams(window.location.search);
  const targetQuality = selectedQuality || urlParams.get('quality');
  if (targetQuality) {
      let match = null;
      if (targetQuality === 'highest' || targetQuality === 'best') {
          match = variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
      } else if (targetQuality === 'lowest') {
          match = variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
      } else {
          if (targetQuality.includes('@')) {
              const parts = targetQuality.split('@');
              const res = parts[0];
              const bw = parseInt(parts[1], 10);
              match = variants.find(v => v.resolution === res && v.bandwidth === bw);
          }
          if (!match) {
              match = variants.find(v => v.resolution === targetQuality || v.bandwidth.toString() === targetQuality);
          }
      }
      if (match) {
          try {
              const res = await fetchWithCache(match.uri, options);
              const text = await res.text();
              const duration = text.split('\n')
                .filter(line => line.startsWith("#EXTINF:"))
                .map(line => parseFloat(line.replace("#EXTINF:", "")))
                .reduce((sum, dur) => sum + dur, 0);

              match.estimatedSize = (match.bandwidth * duration) / 8;
              match.duration = duration;
          } catch (e) {
              console.warn("Could not fetch duration for pre-selected variant", match.uri);
              match.estimatedSize = null;
          }
          return match;
      }
  }

  await Promise.all(variants.map(async (variant) => {
    try {
      const res = await fetchWithCache(variant.uri, options);
      const text = await res.text();
      const duration = text.split('\n')
        .filter(line => line.startsWith("#EXTINF:"))
        .map(line => parseFloat(line.replace("#EXTINF:", "")))
        .reduce((sum, dur) => sum + dur, 0);

      const estimatedSize = (variant.bandwidth * duration) / 8;
      variant.estimatedSize = estimatedSize;
      variant.duration = duration;
    } catch (e) {
      console.warn("Could not fetch duration for", variant.uri);
      variant.estimatedSize = null;
    }
  }));

  if (variants.length === 1) return variants[0];

  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"]));
  if (preference === "highest") return variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  if (preference === "lowest") return variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));

  return new Promise((resolve) => {
    const dialog = document.createElement("mdui-dialog");
    dialog.headline = browser.i18n.getMessage("streamQualityDialogTitle")

    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.textContent = browser.i18n.getMessage("streamQualitySelectLabel")
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");

    variants.forEach((v, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);
      const bandwidthKbps = Math.round(v.bandwidth / 1000).toString();
      const humanSize = getHumanReadableSize(v.estimatedSize) || "Size N/A";
      option.textContent = browser.i18n.getMessage("qualityResolutionBandwidthSize", [v.resolution, bandwidthKbps, humanSize]) || `${v.resolution} (${bandwidthKbps} kbps, ${humanSize})`;
      select.appendChild(option);
    });

    content.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";

    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const selectedIndex = select.value || 0;
      document.body.removeChild(dialog);
      resolve(variants[selectedIndex]);
    });

    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);

    document.body.appendChild(dialog);
    requestAnimationFrame(() => dialog.open = true);
  });
}

async function downloadMPDOffline(mpdUrl, headers, downloadMethod, loadingBar, request, customFilename = null, audioOnly = false, selectedQuality = null) {
  await ensureClientZipLoaded();
  const throwIfCancelled = () => {
    if (window.activeCancellations && window.activeCancellations.has(mpdUrl)) throw new Error("Cancelled");
  };
  throwIfCancelled();
  await ensureClientZipLoaded();

  function sanitizeZipPath(originalPath) {
    if (!originalPath || typeof originalPath !== "string") return originalPath || "";
    if (/^https?:\/\//i.test(originalPath) || /^\/\//.test(originalPath)) {
      try {
        const parsed = new URL(originalPath, "http://example.invalid");
        const p = parsed.pathname.replace(/^\//, "");
        return p || parsed.hostname;
      } catch (e) {
        return originalPath.replace(/^https?:\/\//i, "").replace(/[:?#]/g, "_");
      }
    }
    const parts = originalPath.split("/");
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (seg === "" || seg === ".") continue;
      else if (seg === "..") {
        if (out.length > 0) out.pop();
        else continue;
      } else out.push(seg);
    }
    if (out.length === 0) {
      const fallback = originalPath.split("/").filter(Boolean).slice(-1)[0] || "file";
      return fallback.replace(/[^a-zA-Z0-9._-]/g, "_");
    }
    return out.join("/");
  }

  const resp = await fetchWithCache(mpdUrl, {
    method: request.method,
    headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
    referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value || ""
  });
  throwIfCancelled();
  if (!resp.ok) throw new Error(browser.i18n.getMessage("mpdFetchError", [resp.status.toString()]));
  let mpdXmlText = await resp.text();

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(mpdXmlText, "application/xml");
  const NS = xmlDoc.documentElement.namespaceURI || "urn:mpeg:dash:schema:mpd:2011";

  const hasDRM = !!xmlDoc.getElementsByTagNameNS(NS, "ContentProtection").length;
  let drmAbort = false;
  if (hasDRM) {
    await mdui.confirm({
      headline: browser.i18n.getMessage("drmWarningTitle"),
      description: browser.i18n.getMessage("drmWarningDescription"),
      confirmText: browser.i18n.getMessage("drmWarningConntinueButton"),
      cancelText: browser.i18n.getMessage("drmWarningCancelButton"),
      onCancel: () => { drmAbort = true; },
    });
  }

        if (drmAbort) {
            throw new Error(browser.i18n.getMessage("drmAbortedError") || "Download aborted by user due to DRM protection.");
        }

  const periodList = xmlDoc.getElementsByTagNameNS(NS, "Period");
  if (!periodList || periodList.length === 0) throw new Error(browser.i18n.getMessage("mpdNoPeriodError"));
  const period = periodList[0];

  let baseURLNode = period.getElementsByTagNameNS(NS, "BaseURL")[0];
  let baseURLForZip = baseURLNode ? baseURLNode.textContent.trim() : "";
  if (baseURLForZip.match(/^https?:\/\//i)) {
    try {
      const u = new URL(baseURLForZip);
      baseURLForZip = u.pathname.replace(/^\//, "");
    } catch (e) { baseURLForZip = ""; }
  }
  if (baseURLForZip && !baseURLForZip.endsWith("/")) baseURLForZip += "/";

  const allSets = Array.from(period.getElementsByTagNameNS(NS, "AdaptationSet"));
  const adaptationSets = allSets.filter(asNode => {
    const mimeType = asNode.getAttribute("mimeType")?.toLowerCase() || "";
    const contentType = asNode.getAttribute("contentType")?.toLowerCase() || "";
    if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return true;
    if (contentType === "audio" || contentType === "video") return true;
    const reps = asNode.getElementsByTagNameNS(NS, "Representation");
    for (let i = 0; i < reps.length; i++) {
      const rm = reps[i].getAttribute("mimeType")?.toLowerCase() || "";
      if (rm.startsWith("audio/") || rm.startsWith("video/")) return true;
    }
    return false;
  });
  if (adaptationSets.length === 0) throw new Error(browser.i18n.getMessage("mpdNoMediaError"));

  const parsedAdaptations = adaptationSets.map(asNode => {
    const declaredType = asNode.getAttribute("contentType");
    let contentType;
    if (declaredType === "video" || declaredType === "audio") contentType = declaredType;
    else {
      const mimeType = asNode.getAttribute("mimeType")?.toLowerCase() || "";
      if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) contentType = mimeType.startsWith("video/") ? "video" : "audio";
      else {
        const reps = asNode.getElementsByTagNameNS(NS, "Representation");
        if (reps.length > 0) {
          const repMimeType = reps[0].getAttribute("mimeType")?.toLowerCase() || "";
          contentType = repMimeType.startsWith("video/") ? "video" : "audio";
        } else contentType = "video";
      }
    }

    const setSegTmplNode = asNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];

    let baseSegTmpl = null;
    if (setSegTmplNode) {
      baseSegTmpl = {
        media: setSegTmplNode.getAttribute("media"),
        initialization: setSegTmplNode.getAttribute("initialization"),
        duration: parseInt(setSegTmplNode.getAttribute("duration") || "0", 10),
        timescale: parseInt(setSegTmplNode.getAttribute("timescale") || "1", 10),
        startNumber: setSegTmplNode.getAttribute("startNumber") !== null ? parseInt(setSegTmplNode.getAttribute("startNumber"), 10) : 1,
      };
    }

    const repNodes = Array.from(asNode.getElementsByTagNameNS(NS, "Representation"));
    if (repNodes.length === 0) throw new Error("AdaptationSet has no Representation elements.");

    const representations = repNodes.map(rNode => {
      const id = rNode.getAttribute("id");
      const bandwidth = parseInt(rNode.getAttribute("bandwidth") || "0", 10);
      const width = parseInt(rNode.getAttribute("width") || "0", 10);
      const height = parseInt(rNode.getAttribute("height") || "0", 10);

      const repSegTmplNode = rNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
      if (repSegTmplNode || setSegTmplNode) {
        const tmplNode = repSegTmplNode || setSegTmplNode;
        const segTmpl = {
          media: tmplNode.getAttribute("media"),
          initialization: tmplNode.getAttribute("initialization"),
          duration: parseInt(tmplNode.getAttribute("duration") || (baseSegTmpl ? baseSegTmpl.duration.toString() : "0"), 10),
          timescale: parseInt(tmplNode.getAttribute("timescale") || (baseSegTmpl ? baseSegTmpl.timescale.toString() : "1"), 10),
          startNumber: tmplNode.getAttribute("startNumber") !== null ? parseInt(tmplNode.getAttribute("startNumber"), 10) : (baseSegTmpl ? baseSegTmpl.startNumber : 1),
        };
        return { id, bandwidth, width, height, type: "segmentTemplate", segmentTemplate: segTmpl };
      }

      const repSegBaseNode = rNode.getElementsByTagNameNS(NS, "SegmentBase")[0] || asNode.getElementsByTagNameNS(NS, "SegmentBase")[0];
      if (repSegBaseNode) {
        const initNode = repSegBaseNode.getElementsByTagNameNS(NS, "Initialization")[0];
        const initRange = initNode ? initNode.getAttribute("range") : null;
        const indexRange = repSegBaseNode.getAttribute("indexRange") || null;
        const repBaseURLNode = rNode.getElementsByTagNameNS(NS, "BaseURL")[0] || asNode.getElementsByTagNameNS(NS, "BaseURL")[0];
        const baseURLText = repBaseURLNode ? repBaseURLNode.textContent.trim() : null;
        return { id, bandwidth, width, height, type: "segmentBase", baseURL: baseURLText, initRange, indexRange };
      }

      const repSegListNode = rNode.getElementsByTagNameNS(NS, "SegmentList")[0] || asNode.getElementsByTagNameNS(NS, "SegmentList")[0];
      if (repSegListNode) {
        const initNode = repSegListNode.getElementsByTagNameNS(NS, "Initialization")[0];
        const initUrl = initNode?.getAttribute("sourceURL") || initNode?.textContent?.trim() || null;

        const segNodes = Array.from(repSegListNode.getElementsByTagNameNS(NS, "SegmentURL"));
        const segmentUrls = segNodes
          .map(n => n.getAttribute("media"))
          .filter(Boolean);

        if (!initUrl) {
          throw new Error("SegmentList is missing Initialization@sourceURL.");
        }
        if (segmentUrls.length === 0) {
          throw new Error("SegmentList has no SegmentURL entries.");
        }

        return {
          id,
          bandwidth,
          width,
          height,
          type: "segmentList",
          initializationUrl: initUrl,
          segmentUrls,
        };
      }

      throw new Error("AdaptationSet missing SegmentTemplate/SegmentBase. Downloading this MPD is not supported yet.");
    });

    return { contentType, representations, node: asNode };
  });

  const videoAdaptation = parsedAdaptations.find(a => a.contentType === "video");
  const audioAdaptation = parsedAdaptations.find(a => a.contentType === "audio");

  if (!videoAdaptation && !audioAdaptation) {
    throw new Error("MPD has no audio or video AdaptationSet.");
  }

  const chosenVideoRep = videoAdaptation && !audioOnly
    ? await selectMPDVideoRepresentation(videoAdaptation.representations, selectedQuality)
    : null;

  const chosenAudioRep = audioAdaptation
    ? await selectMPDAudioRepresentation(audioAdaptation.representations, selectedQuality)
    : null;

  if (audioOnly && !chosenAudioRep) {
    throw new Error(browser.i18n.getMessage("audioExtractionNotSupported") || "This MPD does not contain an audio track.");
  }

  const mpdBase = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);
  const mpdFilename = customFilename || getFileName(mpdUrl);
  const baseName = mpdFilename.replace(/\.mpd$/i, "");

  const isSegmentBaseOnly =
  (!!chosenVideoRep || !!chosenAudioRep) &&
  (!chosenVideoRep || chosenVideoRep.type === "segmentBase") &&
  (!chosenAudioRep || chosenAudioRep.type === "segmentBase");

  async function fetchWithProgress(url, { onStart, onChunk } = {}) {
    throwIfCancelled();
    const fetchOptions = {
      method: request.method,
      headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
      referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value || ""
    };

    if (request.method !== 'GET' && request.requestBody) {
      if (request.requestBody.type === 'formData') {
        const formData = new FormData();
        for (const key in request.requestBody.data) {
          request.requestBody.data[key].forEach(val => formData.append(key, val));
        }
        fetchOptions.body = formData;
      } else if (request.requestBody.type === 'base64') {
        const bin = atob(request.requestBody.data);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        fetchOptions.body = u;
      }
    }

    const checkCancel = () => {
      try { throwIfCancelled(); return false; } catch (_) { return true; }
    };
    if (!onStart && !onChunk) {
      const buffer = await fetchSegmentBufferWithRetry(url, fetchOptions, checkCancel, mpdUrl);
      throwIfCancelled();
      return new Blob([buffer]);
    }

    const r = await fetchSegmentWithRetry(url, fetchOptions, checkCancel, mpdUrl);
    throwIfCancelled();
    if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);

    const contentLength = Number(r.headers.get("Content-Length")) || 0;
    if (onStart) onStart(contentLength);

    if (!r.body) {
      if (onChunk) onChunk(0, contentLength);
      return new Blob([]);
    }

    const reader = r.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        throwIfCancelled();
        await waitForSegmentPause(mpdUrl, checkCancel);
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new Blob([value]));
        received += value.byteLength;
        if (onChunk) onChunk(received, contentLength);
      }
    } catch (err) {
      try { reader.cancel(); } catch (e) { }
      if (err?.message === "Cancelled") throw err;
      throw new Error(`Error reading response stream: ${err?.message || err}`);
    }

    return new Blob(chunks);
  }

  if (isSegmentBaseOnly) {
    const snackbar = document.createElement('mdui-snackbar');
    snackbar.setAttribute('open', true);
    snackbar.setAttribute('timeout', 10000);
    snackbar.textContent = browser.i18n.getMessage("splitDownloadWarningSnackbar")
    document.body.appendChild(snackbar);
    snackbar.addEventListener('close', () => {
      snackbar.remove();
    });
    const downloads = [];
    if (chosenVideoRep) downloads.push({ rep: chosenVideoRep, label: "video" });
    if (chosenAudioRep) downloads.push({ rep: chosenAudioRep, label: "audio" });

    loadingBar.value = 0;
    let downloadedBytes = 0;
    let sawUnknownLength = false;

    function addToMax(n) {
      if (!loadingBar._max) loadingBar._max = 0;
      loadingBar._max += n;
    }

    const settings = await browser.storage.local.get(['speed-boost', 'connections']);
    const isParallel = settings['speed-boost'] === '1';
    const concurrency = isParallel ? parseInt(settings['connections'] || '4', 10) : 1;
    const queue = new ParallelQueue(concurrency);

    const downloadDirectTask = async (d) => {
      const url = new URL(d.rep.baseURL, mpdBase).href;

      let candidate = baseName;
      if (!candidate || candidate === "") {
        candidate = d.label === "video" ? `${baseName}_video.mp4` : `${baseName}_audio.mp4`;
      } else {
        candidate += d.label === "video" ? "_video.mp4" : "_audio.mp3";
      }
      const filename = candidate;

      let lastReceivedForFile = 0;
      const blob = await fetchWithProgress(url, {
        onStart: (contentLength) => {
          if (contentLength && contentLength > 0) {
            addToMax(contentLength);
          } else {

            sawUnknownLength = true;
            loadingBar.setAttribute("indeterminate", "");
          }
        },
        onChunk: (received, contentLength) => {
          const delta = received - lastReceivedForFile;
          lastReceivedForFile = received;
          downloadedBytes += delta;

          const max = loadingBar._max || 0;
          updateProgressStatus(loadingBar, downloadedBytes, max);
        }
      });

      throwIfCancelled();
      let finalBlob = blob;
      let finalName = filename;
      if (audioOnly) {
        const mp3Enabled = (await browser.storage.local.get('audio-to-mp3'))['audio-to-mp3'] === '1';
        if (mp3Enabled) {
          const converted = await convertM4aToMp3Direct(blob, customFilename || (baseName + ".mp3"), loadingBar, throwIfCancelled);
          finalBlob = converted.blob;
          finalName = converted.filename;
        } else {
          finalName = (customFilename || baseName).replace(/\.[a-zA-Z0-9]+$/, '') + ".m4a";
        }
      }
      throwIfCancelled();
      await finalizeDownload(finalBlob, finalName, downloadMethod, loadingBar);
    };

    const directTasks = downloads.map(d => queue.add(() => downloadDirectTask(d)));
    await Promise.all(directTasks);

    const finalMax = loadingBar._max || downloadedBytes || 1;
    updateProgressStatus(loadingBar, downloadedBytes, finalMax);

    showDialog(browser.i18n.getMessage("splitAudioVideoDownloadCompleteDescription", [baseName, ".mp4"]), browser.i18n.getMessage("splitAudioVideoDownloadCompleteTitle"), { error: browser.i18n.getMessage("splitAudioVideoDownloadCompleteSuccess", [baseName]), url: mpdUrl, request: request, downloadMethod: downloadMethod });
    return;
  }

  const mpdToMp4Settings = await browser.storage.local.get("mpd-to-mp4");
  const mpdToMp4Enabled = mpdToMp4Settings["mpd-to-mp4"] === "1" || audioOnly;

  const snackbar = document.createElement('mdui-snackbar');
  snackbar.setAttribute('open', true);
  snackbar.setAttribute('timeout', 10000);
  snackbar.textContent = mpdToMp4Enabled 
    ? browser.i18n.getMessage("mpdDownloadMergeExplainSnackbar")
    : browser.i18n.getMessage("mpdDownloadExplainSnackbar");
  document.body.appendChild(snackbar);
  snackbar.addEventListener('close', () => snackbar.remove());

  function substituteVars(path, rep, extra = {}) {
    return path
      .replace(/\$RepresentationID\$/g, rep.id)
      .replace(/\$Bandwidth\$/g, rep.bandwidth)
      .replace(/\$Number\$/g, extra.number !== undefined ? String(extra.number) : "$Number$")
      .replace(/\$Time\$/g, extra.time !== undefined ? String(extra.time) : "$Time$");
  }

  function buildSegmentUrlsForTemplate(rep) {
    const tmpl = rep.segmentTemplate;
    const baseUrl = mpdBase;
    const initPath = substituteVars(tmpl.initialization, rep, {});
    const initUrl = new URL(initPath, baseUrl).href;
    const initZipPath = sanitizeZipPath(initPath);

    let repNode = Array.from(xmlDoc.getElementsByTagNameNS(NS, "Representation")).find(r => r.getAttribute("id") === rep.id);
    let tmplNode = null;
    if (repNode) {
      tmplNode = repNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
      if (!tmplNode && repNode.parentElement) tmplNode = repNode.parentElement.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
    } else tmplNode = xmlDoc.getElementsByTagNameNS(NS, "SegmentTemplate")[0];

    let segmentStartTimes = null;
    const timelineNode = tmplNode ? tmplNode.getElementsByTagNameNS(NS, "SegmentTimeline")[0] : null;
    if (timelineNode) {
      const sElems = Array.from(timelineNode.getElementsByTagNameNS(NS, "S"));
      segmentStartTimes = [];
      let cursor = null;
      for (let i = 0; i < sElems.length; i++) {
        const s = sElems[i];
        const tAttr = s.getAttribute("t");
        const dAttr = s.getAttribute("d");
        const rAttr = s.getAttribute("r");
        if (!dAttr) throw new Error("SegmentTimeline S element missing 'd' attribute — cannot compute segments.");
        const d = parseInt(dAttr, 10);
        const r = rAttr !== null ? parseInt(rAttr, 10) : 0;
        if (tAttr !== null) cursor = parseInt(tAttr, 10);
        else if (cursor === null) cursor = 0;
        const repeatCount = r + 1;
        for (let k = 0; k < repeatCount; k++) {
          segmentStartTimes.push(cursor);
          cursor += d;
        }
      }
    }

    const usesTimeVar = tmpl.media && tmpl.media.indexOf("$Time$") !== -1;
    const mediaPaths = [];
    const mediaZipPaths = [];
    const segmentUrls = [];
    const firstIndex = tmpl.startNumber ?? 1;

    if (usesTimeVar) {
      if (!segmentStartTimes) {
        if (tmpl.duration && tmpl.duration > 0) {
          const segLen = tmpl.duration;
          const mpdRoot = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0];
          const totalDurationISO = mpdRoot.getAttribute("mediaPresentationDuration");
          const parseISODuration = d => {
            const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d);
            if (!m) return 0;
            const years = parseFloat(m[1] || "0");
            const months = parseFloat(m[2] || "0");
            const days = parseFloat(m[3] || "0");
            const hours = parseFloat(m[4] || "0");
            const minutes = parseFloat(m[5] || "0");
            const secs = parseFloat(m[6] || "0");
            return (years * 365 * 24 * 3600 + months * 30 * 24 * 3600 + days * 24 * 3600 + hours * 3600 + minutes * 60 + secs);
          };
          const totalSec = parseISODuration(totalDurationISO);
          const segLenSec = segLen / (tmpl.timescale || 1);
          const estimatedCount = Math.ceil(totalSec / segLenSec);

          segmentStartTimes = [];
          for (let i = 0; i < estimatedCount; i++) segmentStartTimes.push(i * segLen);
        } else {
          throw new Error(browser.i18n.getMessage("dashComputeSegmentsError") || "Cannot compute $Time$ segments: SegmentTimeline missing and no fixed duration provided.");
        }
      }

      for (let i = 0; i < segmentStartTimes.length; i++) {
        const t = segmentStartTimes[i];
        const mediaPath = substituteVars(tmpl.media, rep, { time: t, number: firstIndex + i });
        mediaPaths.push(mediaPath);
        mediaZipPaths.push(sanitizeZipPath(mediaPath));
        segmentUrls.push(new URL(mediaPath, baseUrl).href);
      }
    } else {

      if (segmentStartTimes && segmentStartTimes.length > 0) {
        for (let i = 0; i < segmentStartTimes.length; i++) {
          const number = (tmpl.startNumber ?? 1) + i;
          const mediaPath = substituteVars(tmpl.media, rep, { number });
          mediaPaths.push(mediaPath);
          mediaZipPaths.push(sanitizeZipPath(mediaPath));
          segmentUrls.push(new URL(mediaPath, baseUrl).href);
        }
      } else {

        const mpdRoot = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0];
        const totalDurationISO = mpdRoot.getAttribute("mediaPresentationDuration");
        const parseISODuration = d => {
          const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d);
          if (!m) return 0;
          const years = parseFloat(m[1] || "0");
          const months = parseFloat(m[2] || "0");
          const days = parseFloat(m[3] || "0");
          const hours = parseFloat(m[4] || "0");
          const minutes = parseFloat(m[5] || "0");
          const secs = parseFloat(m[6] || "0");
          return (years * 365 * 24 * 3600 + months * 30 * 24 * 3600 + days * 24 * 3600 + hours * 3600 + minutes * 60 + secs);
        };
        const totalSec = parseISODuration(totalDurationISO);

        const segLenSec = (tmpl.duration || 0) / (tmpl.timescale || 1);
        if (!segLenSec || segLenSec <= 0) throw new Error(browser.i18n.getMessage("dashNumberSegmentsError") || "Cannot compute number-based segments: no SegmentTimeline and duration/timescale missing or zero.");
        const segmentCount = Math.ceil(totalSec / segLenSec);
        for (let i = 0; i < segmentCount; i++) {
          const number = (tmpl.startNumber ?? 1) + i;
          const mediaPath = substituteVars(tmpl.media, rep, { number });
          mediaPaths.push(mediaPath);
          mediaZipPaths.push(sanitizeZipPath(mediaPath));
          segmentUrls.push(new URL(mediaPath, baseUrl).href);
        }
      }
    }

    return {
      initPath,
      initZipPath,
      initUrl,
      mediaPaths,
      mediaZipPaths,
      segmentUrls,
      firstIndex
    };
  }

  const sessionId = "mpd_conv_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
  const zipEntries = [];
  zipEntries.push({ name: mpdFilename, input: new TextEncoder().encode(mpdXmlText) });

  const tasks = [];
  let videoIndices = [];
  let audioIndices = [];
  function queueTemplateDownloads(repObj) {
    const info = buildSegmentUrlsForTemplate(repObj);
    tasks.push({ type: "template", rep: repObj, info });
  }
  function queueBaseDownload(repObj) {
    const baseURLText = repObj.baseURL || "";
    const resolvedUrl = new URL(baseURLText, mpdBase).href;
    let sanitized = sanitizeZipPath(baseURLText || "");
    if (!sanitized) sanitized = `${baseName}_rep${repObj.id}.mp4`;
    else if (!sanitized.match(/\.[a-zA-Z0-9]{1,6}$/)) sanitized = sanitized + `.mp4`;
    tasks.push({ type: "base", rep: repObj, url: resolvedUrl, zipName: sanitized, baseURLText });
  }
  function queueListDownload(repObj) {
    const initUrl = new URL(repObj.initializationUrl, mpdBase).href;
    const initZipPath = sanitizeZipPath(repObj.initializationUrl);

    const segmentUrls = repObj.segmentUrls.map(u => new URL(u, mpdBase).href);
    const segmentZipPaths = repObj.segmentUrls.map(u => sanitizeZipPath(u));

    tasks.push({
      type: "list",
      rep: repObj,
      info: {
        initUrl,
        initZipPath,
        segmentUrls,
        segmentZipPaths,
      }
    });
  }

  if (chosenVideoRep) {
    if (chosenVideoRep.type === "segmentTemplate") queueTemplateDownloads(chosenVideoRep);
    else if (chosenVideoRep.type === "segmentBase") queueBaseDownload(chosenVideoRep);
    else if (chosenVideoRep.type === "segmentList") queueListDownload(chosenVideoRep);
    else throw new Error(browser.i18n.getMessage("unsupportedVideoType") || "Unsupported video representation type");
  }

  if (chosenAudioRep) {
    if (chosenAudioRep.type === "segmentTemplate") queueTemplateDownloads(chosenAudioRep);
    else if (chosenAudioRep.type === "segmentBase") queueBaseDownload(chosenAudioRep);
    else if (chosenAudioRep.type === "segmentList") queueListDownload(chosenAudioRep);
    else throw new Error(browser.i18n.getMessage("unsupportedAudioType") || "Unsupported audio representation type");
  }

  let globalTotalSegments = 0;
  let globalProcessedSegments = 0;
  let downloadedBytes = 0;
  let useByteTracking = false;

  for (const t of tasks) {
    if (t.type === "template" || t.type === "list") {
      globalTotalSegments += t.info.segmentUrls.length;
    } else if (t.type === "base") {
      useByteTracking = true;
    }
  }

  if (useByteTracking) {
    loadingBar.removeAttribute("indeterminate");
    loadingBar._max = 0;
    loadingBar.value = 0;
  } else {
    loadingBar._max = globalTotalSegments;
    loadingBar.value = 0;
  }

  function addToMax(n) {
    if (!loadingBar._max) loadingBar._max = 0;
    loadingBar._max += n;
  }

  const mpdFixEnabled = (await browser.storage.local.get("mpd-fix").then((result) => result["mpd-fix"])) === "1";
  const repIdToLocalName = {};

  const parallelSettings = await browser.storage.local.get(['speed-boost', 'connections']);
  const isParallel = parallelSettings['speed-boost'] === '1';
  const concurrency = isParallel ? parseInt(parallelSettings['connections'] || '4', 10) : 1;
  const queue = new ParallelQueue(concurrency);

  let currentChunkGlobalIndex = 1; 

  const processTask = async (t) => {
    const isVideo = t.rep.contentType === "video" || t.rep === chosenVideoRep;
    if (t.type === "template") {
      const initIdx = currentChunkGlobalIndex++;
      const segIndices = t.info.segmentUrls.map(() => currentChunkGlobalIndex++);
      if (isVideo) {
          videoIndices = [initIdx, ...segIndices];
      } else {
          audioIndices = [initIdx, ...segIndices];
      }

      const initBuf = await fetchWithProgress(t.info.initUrl);
      await storeConversionChunk(sessionId, initIdx, new Blob([initBuf]));
      zipEntries.push({ name: prefixedName(t.info.initZipPath), inputIdx: initIdx });

      const segTasks = t.info.segmentUrls.map((segUrl, i) => {
        const segIdx = segIndices[i];
        return queue.add(async () => {
          const segZipPath = t.info.mediaZipPaths[i];
          const buf = await fetchWithProgress(segUrl);
          await storeConversionChunk(sessionId, segIdx, new Blob([buf]));
          zipEntries.push({ name: prefixedName(segZipPath), inputIdx: segIdx });

          globalProcessedSegments++;
          updateSegmentProgressStatus(loadingBar, globalProcessedSegments, globalTotalSegments);
        });
      });
      await Promise.all(segTasks);

    } else if (t.type === "base") {
      const baseIdx = currentChunkGlobalIndex++;
      if (isVideo) {
          videoIndices = [baseIdx];
      } else {
          audioIndices = [baseIdx];
      }

      await queue.add(async () => {
          let lastReceivedForFile = 0;
          const arrayBuffer = await fetchWithProgress(t.url, {
            onStart: (contentLength) => {
              if (contentLength && contentLength > 0) addToMax(contentLength);
              else loadingBar.setAttribute("indeterminate", "");
            },
            onChunk: (received) => {
              const delta = received - lastReceivedForFile;
              lastReceivedForFile = received;
              downloadedBytes += delta;
              const max = loadingBar._max || 0;
              updateProgressStatus(loadingBar, downloadedBytes, max);
            }
          });

          const finalZipName = prefixedName(t.zipName);
          await storeConversionChunk(sessionId, baseIdx, new Blob([arrayBuffer]));
          zipEntries.push({ name: finalZipName, inputIdx: baseIdx });
          if (mpdFixEnabled) repIdToLocalName[t.rep.id] = t.zipName;
      });
    } else if (t.type === "list") {
      const initIdx = currentChunkGlobalIndex++;
      const segIndices = t.info.segmentUrls.map(() => currentChunkGlobalIndex++);
      if (isVideo) {
          videoIndices = [initIdx, ...segIndices];
      } else {
          audioIndices = [initIdx, ...segIndices];
      }

      const initBuf = await fetchWithProgress(t.info.initUrl);
      await storeConversionChunk(sessionId, initIdx, new Blob([initBuf]));
      zipEntries.push({ name: prefixedName(t.info.initZipPath), inputIdx: initIdx });

      const segTasks = t.info.segmentUrls.map((segUrl, i) => {
        const segIdx = segIndices[i];
        return queue.add(async () => {
            const segZipPath = t.info.segmentZipPaths[i];
            const buf = await fetchWithProgress(segUrl);
            await storeConversionChunk(sessionId, segIdx, new Blob([buf]));
            zipEntries.push({ name: prefixedName(segZipPath), inputIdx: segIdx });

            globalProcessedSegments++;
            updateSegmentProgressStatus(loadingBar, globalProcessedSegments, globalTotalSegments);
        });
      });
      await Promise.all(segTasks);

      if (mpdFixEnabled) repIdToLocalName[t.rep.id] = { type: "list", init: t.info.initZipPath, segments: t.info.segmentZipPaths };
    }
  };

  try {
    for (const t of tasks) {
      await processTask(t);
    }

    if (mpdFixEnabled) {
      const selectedRepIds = new Set();
      if (chosenVideoRep) selectedRepIds.add(chosenVideoRep.id);
      if (chosenAudioRep) selectedRepIds.add(chosenAudioRep.id);

      pruneToSelectedRepresentations(xmlDoc, NS, selectedRepIds);
      for (const repId in repIdToLocalName) {
        const repNode = Array.from(xmlDoc.getElementsByTagNameNS(NS, "Representation"))
          .find(r => r.getAttribute("id") === repId);
        if (!repNode) continue;

        const meta = repIdToLocalName[repId];

        if (typeof meta === "string") {
          const segBases = Array.from(repNode.getElementsByTagNameNS(NS, "SegmentBase"));
          segBases.forEach(n => n.parentElement && n.parentElement.removeChild(n));
          let baseNode = repNode.getElementsByTagNameNS(NS, "BaseURL")[0];
          if (!baseNode) {
            baseNode = xmlDoc.createElementNS(NS, "BaseURL");
            if (repNode.firstChild) repNode.insertBefore(baseNode, repNode.firstChild);
            else repNode.appendChild(baseNode);
          }
          baseNode.textContent = meta;
        } else if (meta?.type === "list") {
          const initNode = repNode.getElementsByTagNameNS(NS, "Initialization")[0];
          if (initNode) {
            initNode.setAttribute("sourceURL", meta.init);
          }

          const segNodes = Array.from(repNode.getElementsByTagNameNS(NS, "SegmentURL"));
          segNodes.forEach((node, idx) => {
            if (meta.segments[idx]) {
              node.setAttribute("media", meta.segments[idx]);
            }
          });
        }
      }

      const serializer = new XMLSerializer();
      mpdXmlText = serializer.serializeToString(xmlDoc);
      zipEntries[0].input = new TextEncoder().encode(mpdXmlText);
    }

    try {
      const finalMax = loadingBar._max || downloadedBytes || 1;
      updateProgressStatus(loadingBar, downloadedBytes, finalMax);
    } catch (e) { }

    const db = await openCacheDB();
    const zipEntriesGenerator = async function* () {
      for (const entry of zipEntries) {
        if (entry.inputIdx !== undefined) {
          const chunk = await new Promise((resolve, reject) => {
            const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
            const store = tx.objectStore(CHUNK_STORE_NAME);
            const req = store.get([sessionId, entry.inputIdx]);
            req.onsuccess = () => resolve(req.result?.data);
            req.onerror = () => reject(req.error);
          });
          yield { name: entry.name, input: chunk || new Blob([]) };
        } else {
          yield entry;
        }
      }
    };

    const gdriveStreamSettings = await browser.storage.local.get(['gdrive-stream', 'gdrive_token']);
    const isGdriveStream = gdriveStreamSettings['gdrive-stream'] === '1' && gdriveStreamSettings['gdrive_token'];
    let gdriveSessionUri = null;
    const zipName = `${baseName}.zip`;

    if (isGdriveStream) {
        try {
            gdriveSessionUri = await startGDriveStreamUpload(zipName, null, 'application/zip');
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ 
                    message: browser.i18n.getMessage("uploadingToGDrive", [zipName]) || `Uploading ${zipName} to Google Drive...`, 
                    placement: "top"
                });
            }
            if (loadingBar) {
              const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
              if (statusInfo) {
                statusInfo.textContent = browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...";
              }
            }
        } catch (e) {
            console.error("Failed to start GDrive stream upload for MPD ZIP:", e);
        }
    }

    if (gdriveSessionUri) {
        const response = downloadZip(zipEntriesGenerator());
        const reader = response.body.getReader();
        let offset = 0;
        let dashBuffer = [];
        let dashBufferSize = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                dashBuffer.push(value);
                dashBufferSize += value.byteLength;

                if (dashBufferSize >= GDRIVE_CHUNK_UNIT) {
                    const fullData = new Uint8Array(dashBufferSize);
                    let pos = 0;
                    for (const b of dashBuffer) {
                        fullData.set(b, pos);
                        pos += b.byteLength;
                    }

                    const uploadSize = Math.floor(dashBufferSize / GDRIVE_CHUNK_UNIT) * GDRIVE_CHUNK_UNIT;
                    const dataToUpload = fullData.slice(0, uploadSize);
                    const remainder = fullData.slice(uploadSize);
                    
                    let retries = 3;
                    let success = false;
                    while (retries > 0 && !success) {
                        try {
                            await uploadStreamChunk(gdriveSessionUri, dataToUpload, offset);
                            offset += uploadSize;
                            success = true;
                        } catch (e) {
                            retries--;
                            if (retries === 0) throw e;
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }

                    dashBuffer = [remainder];
                    dashBufferSize = remainder.byteLength;
                }
                
                if (loadingBar) {
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) {
                        statusInfo.textContent = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${getHumanReadableSize(offset)})`;
                    }
                }
            }

            // Final flush for DASH
            if (dashBufferSize > 0) {
                const finalData = new Uint8Array(dashBufferSize);
                let pos = 0;
                for (const b of dashBuffer) {
                    finalData.set(b, pos);
                    pos += b.byteLength;
                }
                await uploadStreamChunk(gdriveSessionUri, finalData, offset);
                offset += dashBufferSize;
            }

            await uploadStreamChunk(gdriveSessionUri, new Uint8Array(0), offset, offset);
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ message: browser.i18n.getMessage("uploadSuccessGDrive", [zipName]) || `Successfully saved ${zipName} to Google Drive!`, placement: "top" });
            }
            await finalizeDownload(null, zipName, downloadMethod, loadingBar, true);
        } catch (e) {
            console.error("GDrive stream ZIP upload failed, falling back to local:", e);
            const zipBlob = await downloadZip(zipEntriesGenerator()).blob();
            await finalizeDownload(zipBlob, zipName, downloadMethod, loadingBar);
        }
    } else {
        const mpdToMp4Settings = await browser.storage.local.get("mpd-to-mp4");
        const mpdToMp4Enabled = mpdToMp4Settings["mpd-to-mp4"] === "1" || audioOnly;

        if (mpdToMp4Enabled) {
            const concatenateChunks = async (dbInstance, sessId, indices) => {
                const blobs = [];
                for (const idx of indices) {
                    const chunk = await new Promise((resolve, reject) => {
                        const tx = dbInstance.transaction([CHUNK_STORE_NAME], "readonly");
                        const store = tx.objectStore(CHUNK_STORE_NAME);
                        const req = store.get([sessId, idx]);
                        req.onsuccess = () => resolve(req.result?.data);
                        req.onerror = () => reject(req.error);
                    });
                    if (chunk) {
                        blobs.push(chunk);
                    }
                }
                return new Blob(blobs);
            };

            const muxMPDTracks = async (vBlob, aBlob, outName) => {
                let libavInstance = null;
                try {
                    const libavVar = 'LibAV_h264';
                    const libavScript = 'libraries/libav.js';

                    if (!window[libavVar] || !window[libavVar].LibAV) {
                        const script = document.createElement('script');
                        script.src = browser.runtime.getURL(libavScript);
                        document.head.appendChild(script);
                        await new Promise(resolve => {
                            script.onload = () => resolve();
                        });
                    }
                    
                    libavInstance = await window[libavVar].LibAV({
                        noworker: true,
                        base: browser.runtime.getURL('libraries')
                    });

                    if (vBlob) {
                        await libavInstance.writeFile('input_video.mp4', new Uint8Array(await vBlob.arrayBuffer()));
                    }
                    if (aBlob) {
                        await libavInstance.writeFile('input_audio.mp4', new Uint8Array(await aBlob.arrayBuffer()));
                    }

                    const ffmpegArgs = ["-y"];
                    if (vBlob) ffmpegArgs.push("-i", "input_video.mp4");
                    if (aBlob) ffmpegArgs.push("-i", "input_audio.mp4");

                    if (vBlob && aBlob) {
                        ffmpegArgs.push("-c:v", "copy", "-c:a", "copy", "output.mp4");
                    } else if (vBlob) {
                        ffmpegArgs.push("-c:v", "copy", "output.mp4");
                    } else if (aBlob) {
                        ffmpegArgs.push("-c:a", "copy", "output.mp4");
                    }

                    const exitCode = await libavInstance.ffmpeg(ffmpegArgs);
                    console.log("muxMPDTracks LibAV ffmpeg exit code:", exitCode);

                    let outputData;
                    try {
                        outputData = await libavInstance.readFile("output.mp4");
                    } catch (readErr) {
                        throw new Error("Muxing failed: output.mp4 not created. Exit code: " + exitCode);
                    }
                    
                    return new Blob([outputData.buffer], { type: 'video/mp4' });
                } finally {
                    if (libavInstance) {
                        try {
                            await libavInstance.terminate();
                        } catch (e) {
                            console.warn("muxMPDTracks: Failed to terminate LibAV:", e);
                        }
                    }
                }
            };

            if (loadingBar) {
                const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                if (statusInfo) statusInfo.textContent = "Merging video and audio...";
            }

            let videoBlob = null;
            let audioBlob = null;

            if (videoIndices.length > 0) {
                videoBlob = await concatenateChunks(db, sessionId, videoIndices);
            }
            if (audioIndices.length > 0) {
                audioBlob = await concatenateChunks(db, sessionId, audioIndices);
            }

            if (!videoBlob && !audioBlob) {
                throw new Error("No video or audio tracks downloaded.");
            }

            let finalBlob;
            let finalFilename = baseName + ".mp4";

            if (videoBlob && audioBlob) {
                try {
                    finalBlob = await muxMPDTracks(videoBlob, audioBlob, finalFilename);
                } catch (muxErr) {
                    console.error("Failed to mux MPD tracks, falling back to ZIP:", muxErr);
                    const zipBlob = await downloadZip(zipEntriesGenerator()).blob();
                    await finalizeDownload(zipBlob, zipName, downloadMethod, loadingBar);
                    return;
                }
            } else if (videoBlob) {
                finalBlob = videoBlob;
            } else {
                finalBlob = audioBlob;
                finalFilename = baseName + ".m4a";
                if (audioOnly) {
                    const mp3Enabled = (await browser.storage.local.get('audio-to-mp3'))['audio-to-mp3'] === '1';
                    if (mp3Enabled) {
                        const converted = await convertM4aToMp3Direct(audioBlob, customFilename || (baseName + ".mp3"), loadingBar, throwIfCancelled);
                        finalBlob = converted.blob;
                        finalFilename = converted.filename;
                    } else {
                        finalFilename = (customFilename || baseName).replace(/\.[a-zA-Z0-9]+$/, '') + ".m4a";
                    }
                }
            }

            await finalizeDownload(finalBlob, finalFilename, downloadMethod, loadingBar);
            mdui.alert({
                headline: browser.i18n.getMessage("streamDownloadCompleteTitle") || "Download Complete",
                description: browser.i18n.getMessage("streamDownloadSaved") || "File has been saved.",
                confirmText: "OK"
            });
        } else {
            const zipBlob = await downloadZip(zipEntriesGenerator()).blob();
            await finalizeDownload(zipBlob, zipName, downloadMethod, loadingBar);
        }
    }

    showDialog(browser.i18n.getMessage("mpdDownloadCompleteMessage", [baseName]), browser.i18n.getMessage("mpdDownloadCompleteTitle"), {
      error: browser.i18n.getMessage("mpdDownloadCompleteSuccess", [zipName]),
      urls: { zip: isGdriveStream ? null : URL.createObjectURL(await downloadZip(zipEntriesGenerator()).blob()), mpd: mpdUrl },
      request,
      downloadMethod
    });
  } finally {
    await clearConversionChunks(sessionId);
  }

  function prefixedName(path) {
    if (!baseURLForZip) return path;
    if (path.startsWith(baseURLForZip)) return path;
    return baseURLForZip + path;
  }
}

async function selectMPDVideoRepresentation(reps, selectedQuality = null) {

  if (reps.length === 1) {
    return reps[0];
  }

  const urlParams = new URLSearchParams(window.location.search);
  const targetQuality = selectedQuality || urlParams.get('quality');
  if (targetQuality) {
      let match = null;
      if (targetQuality === 'highest' || targetQuality === 'best') {
          match = reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
      } else if (targetQuality === 'lowest') {
          match = reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
      } else {
          const parts = targetQuality.split('@');
          if (parts.length >= 3) {
              const res = parts[0];
              const bw = parseInt(parts[1], 10);
              const repId = parts.slice(2).join('@');
              match = reps.find(r => `${r.width}x${r.height}` === res && r.bandwidth === bw && r.id === repId);
          } else if (parts.length === 2) {
              const res = parts[0];
              const bw = parseInt(parts[1], 10);
              match = reps.find(r => `${r.width}x${r.height}` === res && r.bandwidth === bw);
          }
          if (!match) {
              match = reps.find(r => r.id === targetQuality || `${r.width}x${r.height}` === targetQuality || r.bandwidth.toString() === targetQuality);
          }
      }
      if (match) {
          return match;
      }
  }

  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"]));

  if (preference === "highest") {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  } else if (preference === "lowest") {
    return reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
  }

  return new Promise((resolve) => {

    const dialog = document.createElement("mdui-dialog");
    dialog.headline = browser.i18n.getMessage("videoQualityDialogTitle");

    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.setAttribute("for", "mpd-video-select");
    label.textContent = browser.i18n.getMessage("videoQualitySelectLabel");
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");
    select.setAttribute("id", "mpd-video-select");

    select.value = "0";

    const sorted = reps.slice().sort((a, b) => a.bandwidth - b.bandwidth);

    sorted.forEach((r, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);
      const kbps = Math.round(r.bandwidth / 1000).toString();
      option.textContent = browser.i18n.getMessage("qualityResolutionBandwidth", [r.width.toString(), r.height.toString(), kbps]) || `${r.width}×${r.height} (${kbps} kbps)`;
      select.appendChild(option);
    });

    content.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";
    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const idx = parseInt(select.value, 10) || 0;
      document.body.removeChild(dialog);

      resolve(sorted[idx]);
    });
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);

    document.body.appendChild(dialog);

    requestAnimationFrame(() => { dialog.open = true; });
  });
}

async function selectMPDAudioRepresentation(reps, selectedQuality = null) {

  if (reps.length === 1) {
    return reps[0];
  }

  if (selectedQuality) {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  }

  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"]));

  if (preference === "highest") {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  } else if (preference === "lowest") {
    return reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
  }

  return new Promise((resolve) => {

    const dialog = document.createElement("mdui-dialog");
    dialog.headline = browser.i18n.getMessage("audioQualityDialogTitle");

    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.setAttribute("for", "mpd-audio-select");
    label.textContent = browser.i18n.getMessage("audioQualitySelectLabel");;
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");
    select.setAttribute("id", "mpd-audio-select");

    select.value = "0";

    const sorted = reps.slice().sort((a, b) => a.bandwidth - b.bandwidth);

    sorted.forEach((r, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);
      const kbps = Math.round(r.bandwidth / 1000).toString();
      option.textContent = browser.i18n.getMessage("qualityBandwidth", [kbps]);
      select.appendChild(option);
    });

    content.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";
    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const idx = parseInt(select.value, 10) || 0;
      document.body.removeChild(dialog);

      resolve(sorted[idx]);
    });
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);

    requestAnimationFrame(() => { dialog.open = true; });
  });
}
