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
                      chunks.push(cursor.value.data);

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
  } else {
    statusInfo.textContent = browser.i18n.getMessage("streamProgressNoSize", [loadedMB]) || `${loadedMB} MB downloaded`;
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
}

async function downloadM3U8Offline(m3u8Url, headers, downloadMethod, loadingBar, request, customFilename = null, audioOnly = false) {
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

    const res = await fetchWithCache(url, fetchOptions);
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
    });
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
    // Display a snackbar message informing the user about the separate audio stream
    const snackbar = document.createElement('mdui-snackbar');
    snackbar.setAttribute('open', true);
    snackbar.setAttribute('timeout', 10000);
    snackbar.textContent = browser.i18n.getMessage("splitDownloadWarningSnackbar")
    document.body.appendChild(snackbar);
    snackbar.addEventListener('close', () => {
      snackbar.remove();
    });
  }

  async function downloadSegments(playlistUrl) {
    const playlistText = await getText(playlistUrl);
    const rawLines = playlistText.split(/\r?\n/);

    // helpers for fetch options
    const fetchOpts = {
      headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
      referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value,
      method: request.method
    };

    // parse media-sequence if present
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

    // Build ordered list of playlist "items" so we can process sequentially
    const items = []; // {type: 'key'|'map'|'segment', ...}
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXT-X-KEY')) {
        // capture the full line for attribute parsing later
        items.push({ type: 'key', raw: line });
      } else if (line.startsWith('#EXT-X-MAP')) {
        items.push({ type: 'map', raw: line });
      } else if (line.startsWith('#')) {
        // other tags ignored here
        continue;
      } else {
        // segment URI line
        items.push({ type: 'segment', uri: new URL(line, playlistUrl).href, rawUri: line });
      }
    }

    const segCount = items.filter(it => it.type === 'segment').length;

    let container = null; // 'fmp4' | 'ts' | 'unknown'

    // encryption state
    let currentKeyBuffer = null;   // ArrayBuffer containing 16 raw bytes
    let currentKeyUri = null;      // string
    let currentKeyIV = null;       // Uint8Array(16) or null

    // segment-based sequence for IV when not provided in EXT-X-KEY
    let processedSegmentIndex = 0; // counts only segments (for IV calc)

    // utility: build 16-byte IV where last 8 bytes are the sequence number (big-endian)
    function makeSequenceIV(seq) {
      const iv = new Uint8Array(16);
      const dv = new DataView(iv.buffer);
      // prefer setBigUint64 if available for clarity/precision
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
      const res = await fetchWithCache(keyHref, fetchOpts);
      const ab = await res.arrayBuffer();

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

    const settings = await browser.storage.local.get(['speed-boost', 'connections']);
    const isParallel = settings['speed-boost'] === '1';
    const concurrency = isParallel ? parseInt(settings['connections'] || '4', 10) : 1;
    const queue = new ParallelQueue(concurrency);

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
          const mapRes = await fetchWithCache(mapHref, fetchOpts);
          let mapData = new Uint8Array(await mapRes.arrayBuffer());

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

    const parts = new Array(segmentsToDownload.length);
    const firstPartMap = segmentsToDownload[0]?.map;

    const downloadTask = async (seg) => {
      if (window.activeCancellations && window.activeCancellations.has(m3u8Url)) {
        throw new Error("Cancelled");
      }
      try {
        const res = await fetchWithCache(seg.uri, fetchOpts);
        let arr = new Uint8Array(await res.arrayBuffer());

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

        parts[seg.index] = arr;

        if (loadingBar) {
          globalProcessedSegments++;
          loadingBar.removeAttribute('indeterminate');
          loadingBar.setAttribute('value', Math.min(1, globalProcessedSegments / globalTotalSegments));
          updateSegmentProgressStatus(loadingBar, globalProcessedSegments, globalTotalSegments);
        }
      } catch (e) {
        console.error(`Segment download failed: ${seg.uri}`, e);
        throw e;
      }
    };

    const tasks = segmentsToDownload.map(seg => queue.add(() => downloadTask(seg)));
    await Promise.all(tasks);

    // Filter out any undefined parts just in case
    const filteredParts = parts.filter(p => p !== undefined);

    // Container detection
    if (filteredParts.length > 0) {
       const firstArr = filteredParts[0];
       if (firstArr[0] === 0x47) container = 'ts';
       else {
          // Check for ftyp/styp in first few bytes (could be shifted by map)
          const searchArea = firstArr.slice(0, 32);
          const hex = Array.from(searchArea).map(b => b.toString(16).padStart(2, '0')).join('');
          if (hex.includes('66747970') || hex.includes('73747970')) container = 'fmp4';
       }
    }

    if (container === 'fmp4') {
      return { blob: new Blob(filteredParts, { type: "video/mp4" }), ext: '.mp4' };
    } else {
      return { blob: new Blob(filteredParts, { type: "video/mp2t" }), ext: '.ts' };
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
       const { blob } = await downloadSegments(videoUrl);
       return { blob };
    }
    globalTotalSegments = await countSegments(audioUrl);
  } else {

    globalTotalSegments += await countSegments(videoUrl);
    if (audioUrl) {
      globalTotalSegments += await countSegments(audioUrl);
    }
  }

  let videoBlob, ext;
  if (!audioOnly) {
    const videoResult = await downloadSegments(videoUrl);
    videoBlob = videoResult.blob;
    ext = videoResult.ext;

    const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(m3u8Url);
    const videoBlobUrl = URL.createObjectURL(videoBlob);

    if (downloadMethod === "browser") {
      await browser.downloads.download({
        url: videoBlobUrl,
        filename: audioUrl ? `${baseFileName}_video${ext}` : `${baseFileName}${ext}`
      });
    } else {
      const videoAnchor = document.createElement("a");
      videoAnchor.href = videoBlobUrl;
      videoAnchor.download = audioUrl ? `${baseFileName}_video${ext}` : `${baseFileName}${ext}`;
      document.body.appendChild(videoAnchor);
      videoAnchor.click();
      document.body.removeChild(videoAnchor);
    }

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
    const { blob: audioBlob } = await downloadSegments(audioUrl, true);

    const audioBlobUrl = URL.createObjectURL(audioBlob);
    const audioExt = audioOnly ? ".mp3" : "_audio.mp4";
    const audioFullFileName = audioOnly ? (customFilename || `${baseFileName}${audioExt}`) : `${baseFileName}${audioExt}`;

    if (downloadMethod === "browser") {
      await browser.downloads.download({
        url: audioBlobUrl,
        filename: audioFullFileName
      });
    } else {
      const audioAnchor = document.createElement("a");
      audioAnchor.href = audioBlobUrl;
      audioAnchor.download = audioFullFileName;
      document.body.appendChild(audioAnchor);
      audioAnchor.click();
      document.body.removeChild(audioAnchor);
    }

    if (audioOnly) {
        showDialog(browser.i18n.getMessage("audioExtractionSuccess", [audioFullFileName]), browser.i18n.getMessage("successTitle"));
    } else {
        showDialog(browser.i18n.getMessage("splitAudioVideoDownloadCompleteDescription", [new Option(baseFileName).innerHTML, ext]), browser.i18n.getMessage("splitAudioVideoDownloadCompleteTitle"), { error: browser.i18n.getMessage("splitAudioVideoDownloadCompleteSuccess", [baseFileName]), urls: { video: URL.createObjectURL(videoBlob), audio: audioBlobUrl, m3u8: m3u8Url }, request: request, downloadMethod: downloadMethod });
    }
    URL.revokeObjectURL(audioBlobUrl);
    return;
  }
}

async function selectStreamVariant(playlistLines, baseUrl, options = {}) {
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

async function downloadMPDOffline(mpdUrl, headers, downloadMethod, loadingBar, request, customFilename = null) {

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

  const chosenVideoRep = videoAdaptation
    ? await selectMPDVideoRepresentation(videoAdaptation.representations)
    : null;

  const chosenAudioRep = audioAdaptation
    ? await selectMPDAudioRepresentation(audioAdaptation.representations)
    : null;

  const mpdBase = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);
  const mpdFilename = customFilename || getFileName(mpdUrl);
  const baseName = mpdFilename.replace(/\.mpd$/i, "");

  const isSegmentBaseOnly =
  (!!chosenVideoRep || !!chosenAudioRep) &&
  (!chosenVideoRep || chosenVideoRep.type === "segmentBase") &&
  (!chosenAudioRep || chosenAudioRep.type === "segmentBase");

  async function fetchWithProgress(url, { onStart, onChunk } = {}) {
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

    const r = await fetchWithCache(url, fetchOptions);
    if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);

    const contentLength = Number(r.headers.get("Content-Length")) || 0;
    if (onStart) onStart(contentLength);

    if (!r.body) {
      if (onChunk) onChunk(0, contentLength);
      return new ArrayBuffer(0);
    }

    const reader = r.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (onChunk) onChunk(received, contentLength);
      }
    } catch (err) {
      try { reader.cancel(); } catch (e) { }
      throw new Error(`Error reading response stream: ${err?.message || err}`);
    }

    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      buffer.set(c, offset);
      offset += c.byteLength;
    }
    return buffer.buffer;
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

    loadingBar.removeAttribute("indeterminate");
    loadingBar.setAttribute("value", 0);
    loadingBar.setAttribute("max", 0);
    let downloadedBytes = 0;
    let sawUnknownLength = false;

    function addToMax(n) {
      const prev = Number(loadingBar.getAttribute("max")) || 0;
      loadingBar.setAttribute("max", prev + n);
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
      const buffer = await fetchWithProgress(url, {
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

          const max = Number(loadingBar.getAttribute("max")) || 0;
          if (max > 0) {
            loadingBar.setAttribute("value", downloadedBytes);
            updateProgressStatus(loadingBar, downloadedBytes, max);
          } else {
            updateProgressStatus(loadingBar, downloadedBytes, 0);
          }
        }
      });

      const blob = new Blob([buffer]);
      const objectUrl = URL.createObjectURL(blob);
      if (downloadMethod === "browser") {
        await browser.downloads.download({ url: objectUrl, filename: filename });
      } else {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      URL.revokeObjectURL(objectUrl);
    };

    const directTasks = downloads.map(d => queue.add(() => downloadDirectTask(d)));
    await Promise.all(directTasks);

    const finalMax = Number(loadingBar.getAttribute("max")) || downloadedBytes || 1;
    loadingBar.setAttribute("max", finalMax);
    loadingBar.setAttribute("value", downloadedBytes);
    loadingBar.removeAttribute("indeterminate");
    updateProgressStatus(loadingBar, downloadedBytes, finalMax);

    showDialog(browser.i18n.getMessage("splitAudioVideoDownloadCompleteDescription", [baseName, ".mp4"]), browser.i18n.getMessage("splitAudioVideoDownloadCompleteTitle"), { error: browser.i18n.getMessage("splitAudioVideoDownloadCompleteSuccess", [baseName]), url: mpdUrl, request: request, downloadMethod: downloadMethod });
    return;
  }

  const snackbar = document.createElement('mdui-snackbar');
  snackbar.setAttribute('open', true);
  snackbar.setAttribute('timeout', 10000);
  snackbar.textContent = browser.i18n.getMessage("mpdDownloadExplainSnackbar");
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

  const zipEntries = [];
  zipEntries.push({ name: mpdFilename, input: new TextEncoder().encode(mpdXmlText) });

  const tasks = [];
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
    loadingBar.setAttribute("max", 0);
    loadingBar.setAttribute("value", 0);
  } else {
    loadingBar.setAttribute("max", globalTotalSegments);
    loadingBar.setAttribute("value", 0);
  }

  function addToMax(n) {
    const prev = Number(loadingBar.getAttribute("max")) || 0;
    loadingBar.setAttribute("max", prev + n);
  }

  const mpdFixEnabled = (await browser.storage.local.get("mpd-fix").then((result) => result["mpd-fix"])) === "1";
  const repIdToLocalName = {};

  const parallelSettings = await browser.storage.local.get(['speed-boost', 'connections']);
  const isParallel = parallelSettings['speed-boost'] === '1';
  const concurrency = isParallel ? parseInt(parallelSettings['connections'] || '4', 10) : 1;
  const queue = new ParallelQueue(concurrency);

  const processTask = async (t) => {
    if (t.type === "template") {

      const initBuf = await fetchWithProgress(t.info.initUrl);
      zipEntries.push({ name: prefixedName(t.info.initZipPath), input: initBuf });

      const segTasks = t.info.segmentUrls.map((segUrl, i) => {
        return queue.add(async () => {
          const segZipPath = t.info.mediaZipPaths[i];
          const buf = await fetchWithProgress(segUrl);
          zipEntries.push({ name: prefixedName(segZipPath), input: buf });

          globalProcessedSegments++;
          loadingBar.setAttribute("value", globalProcessedSegments);
          updateSegmentProgressStatus(loadingBar, globalProcessedSegments, globalTotalSegments);
        });
      });
      await Promise.all(segTasks);

    } else if (t.type === "base") {
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
              const max = Number(loadingBar.getAttribute("max")) || 0;
              if (max > 0) {
                loadingBar.setAttribute("value", downloadedBytes);
                updateProgressStatus(loadingBar, downloadedBytes, max);
              } else {
                updateProgressStatus(loadingBar, downloadedBytes, 0);
              }
            }
          });

          const finalZipName = prefixedName(t.zipName);
          zipEntries.push({ name: finalZipName, input: arrayBuffer });
          if (mpdFixEnabled) repIdToLocalName[t.rep.id] = t.zipName;
      });
    } else if (t.type === "list") {
      const initBuf = await fetchWithProgress(t.info.initUrl);
      zipEntries.push({ name: prefixedName(t.info.initZipPath), input: initBuf });

      const segTasks = t.info.segmentUrls.map((segUrl, i) => {
        return queue.add(async () => {
            const segZipPath = t.info.segmentZipPaths[i];
            const buf = await fetchWithProgress(segUrl);
            zipEntries.push({ name: prefixedName(segZipPath), input: buf });

            globalProcessedSegments++;
            loadingBar.setAttribute("value", globalProcessedSegments);
            updateSegmentProgressStatus(loadingBar, globalProcessedSegments, globalTotalSegments);
        });
      });
      await Promise.all(segTasks);

      if (mpdFixEnabled) repIdToLocalName[t.rep.id] = { type: "list", init: t.info.initZipPath, segments: t.info.segmentZipPaths };
    }
  };

  for (const t of tasks) {
    await processTask(t);
  }

  function pruneToSelectedRepresentations(xmlDoc, NS, selectedRepIds) {
    const adaptationSets = Array.from(xmlDoc.getElementsByTagNameNS(NS, "AdaptationSet"));

    for (const asNode of adaptationSets) {
      const reps = Array.from(asNode.getElementsByTagNameNS(NS, "Representation"));

      for (const rep of reps) {
        const repId = rep.getAttribute("id");
        if (!selectedRepIds.has(repId)) {
          rep.parentElement?.removeChild(rep);
        }
      }

      if (!asNode.getElementsByTagNameNS(NS, "Representation").length) {
        asNode.parentElement?.removeChild(asNode);
      }
    }
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
    zipEntries[0] = { name: mpdFilename, input: new TextEncoder().encode(mpdXmlText) };
  }

  try {
    const finalMax = Number(loadingBar.getAttribute("max")) || downloadedBytes || 1;
    loadingBar.setAttribute("max", finalMax);
    loadingBar.setAttribute("value", downloadedBytes);
    loadingBar.removeAttribute("indeterminate");
    updateProgressStatus(loadingBar, downloadedBytes, finalMax);
  } catch (e) { }

  const zipBlob = await downloadZip(zipEntries).blob();
  const zipName = `${baseName}.zip`;

  if (downloadMethod === "browser") {
    await browser.downloads.download({ url: URL.createObjectURL(zipBlob), filename: zipName });
  } else {

    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  showDialog(browser.i18n.getMessage("mpdDownloadCompleteMessage", [baseName]), browser.i18n.getMessage("mpdDownloadCompleteTitle"), {
    error: browser.i18n.getMessage("mpdDownloadCompleteSuccess", [zipName]),
    urls: { zip: URL.createObjectURL(zipBlob), mpd: mpdUrl },
    request,
    downloadMethod
  });

  function prefixedName(path) {
    if (!baseURLForZip) return path;
    if (path.startsWith(baseURLForZip)) return path;
    return baseURLForZip + path;
  }
}

async function selectMPDVideoRepresentation(reps) {

  if (reps.length === 1) {
    return reps[0];
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

async function selectMPDAudioRepresentation(reps) {

  if (reps.length === 1) {
    return reps[0];
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

