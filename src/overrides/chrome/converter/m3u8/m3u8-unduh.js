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

    tampilnoNotif(browser.i18n.getMessage("splitDownloadWarningSnackbar"), { durasi: 10000 });
  }

  async function downloadSegments(playlistUrl, isAudio = false, customFilename = null, tanpaTransmux = false) {
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
                tampilnoNotif(browser.i18n.getMessage("uploadingToDropbox", [uploadFilename]) || `Uploading ${uploadFilename} to Dropbox...`);
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
                tampilnoNotif(browser.i18n.getMessage("uploadingToGDrive", [uploadFilename]) || `Uploading ${uploadFilename} to Google Drive...`);
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
        await ensureOptionalLibraryLoaded('workers/mp4_duration.js', 'mp4Duration');
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
                      tampilnoNotif(browser.i18n.getMessage("uploadSuccessGDrive", [uploadFilename]) || `Successfully saved ${uploadFilename} to Google Drive!`);
                  }
              }
              if (dropboxSessionId) {
                  await finishDropboxStream(dropboxSessionId, dropboxOffset, uploadFilename);
                  if (typeof mdui !== 'undefined' && mdui.snackbar) {
                      tampilnoNotif(browser.i18n.getMessage("uploadSuccessDropbox", [uploadFilename]) || `Successfully saved ${uploadFilename} to Dropbox!`);
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
        const shouldConvert = convertPref['stream-to-mp4'] !== '0' && !tanpaTransmux;
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

  const pengaturanGabungAwal = await browser.storage.local.get("mpd-to-mp4");
  const akanGabung = !audioOnly && audioUrl && pengaturanGabungAwal["mpd-to-mp4"] === "1";
  let videoBlob, ext, videoStreamed, videoStreamedToGDrive, videoStreamedToDropbox;
  if (!audioOnly) {
    const videoResult = await downloadSegments(videoUrl, false, customFilename, akanGabung);
    videoBlob = videoResult.blob;
    ext = videoResult.ext;
    videoStreamed = videoResult.streamed;
    videoStreamedToGDrive = videoResult.streamedToGDrive;
    videoStreamedToDropbox = videoResult.streamedToDropbox;
  }

  if (audioUrl) {
    const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(m3u8Url);
    loadingBar.setAttribute('aria-label', browser.i18n.getMessage("downloadingAudioSnackbar"));
    tampilnoNotif(browser.i18n.getMessage("downloadingAudioSnackbar"), { durasi: 10000 });
    const { blob: audioBlob, ext: extAudio, streamed: audioStreamed, streamedToGDrive: audioStreamedToGDrive, streamedToDropbox: audioStreamedToDropbox } = await downloadSegments(audioUrl, true, customFilename, akanGabung);

    let finalAudioBlob = audioBlob;
    let finalAudioFileName = audioOnly ? (customFilename || `${baseFileName}.mp3`) : `${baseFileName}_audio${extAudio}`;
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


    if (!audioOnly && videoBlob && audioBlob && !videoStreamedToGDrive && !videoStreamedToDropbox && !audioStreamedToGDrive && !audioStreamedToDropbox) {
        const pengaturanGabung = await browser.storage.local.get("mpd-to-mp4");
        if (pengaturanGabung["mpd-to-mp4"] === "1") {
            try {
                if (loadingBar) {
                    const infoGabung = loadingBar.parentNode.querySelector('.download-status-info');
                    if (infoGabung) infoGabung.textContent = "Merging video and audio...";
                }
                const blobGabung = await gabungkanVideoAudioKeMp4(videoBlob, audioBlob, ext, extAudio);
                if (checkCancel()) throw new Error("Cancelled");
                await finalizeDownload(blobGabung, `${baseFileName}.mp4`, downloadMethod, loadingBar, false, false);
                mdui.alert({
                    headline: browser.i18n.getMessage("streamDownloadCompleteTitle") || "Download Complete",
                    description: browser.i18n.getMessage("streamDownloadSaved") || "File has been saved.",
                    confirmText: "OK"
                });
                return { blob: blobGabung, streamed: false };
            } catch (e) {
                if (e.message === "Cancelled") throw e;
                console.error("Failed to mux HLS tracks, falling back to ZIP:", e);
            }
        }
    }

    if (!audioOnly && videoBlob && audioBlob && !videoStreamedToGDrive && !videoStreamedToDropbox && !audioStreamedToGDrive && !audioStreamedToDropbox) {
        try {
            if (loadingBar) {
                const infoZip = loadingBar.parentNode.querySelector('.download-status-info');
                if (infoZip) infoZip.textContent = "Creating ZIP...";
            }
            await ensureClientZipLoaded();
            const namaZip = `${baseFileName}.zip`;
            const entriZip = async function* () {
                if (checkCancel()) throw new Error("Cancelled");
                yield { name: `${baseFileName}_video${ext}`, input: videoBlob };
                if (checkCancel()) throw new Error("Cancelled");
                yield { name: finalAudioFileName, input: finalAudioBlob };
            };
            const blobZip = await downloadZip(entriZip()).blob();
            if (checkCancel()) throw new Error("Cancelled");
            await finalizeDownload(blobZip, namaZip, downloadMethod, loadingBar, false, false);
            mdui.alert({
                headline: browser.i18n.getMessage("streamDownloadCompleteTitle") || "Download Complete",
                description: browser.i18n.getMessage("streamDownloadSaved") || "File has been saved.",
                confirmText: "OK"
            });
            return { blob: blobZip, streamed: false };
        } catch (e) {
            if (e.message === "Cancelled") throw e;
            console.error("Failed to create HLS ZIP, falling back to separate files:", e);
        }
    }

    if (!audioOnly) {
        const videoBlobUrl = URL.createObjectURL(videoBlob);
        await finalizeDownload(videoBlob, `${baseFileName}_video${ext}`, downloadMethod, loadingBar, videoStreamedToGDrive, videoStreamedToDropbox);
        URL.revokeObjectURL(videoBlobUrl);
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

  if (!audioOnly) {
    const baseFileName = customFilename ? (customFilename.substring(0, customFilename.lastIndexOf('.')) || customFilename) : getFileName(m3u8Url);
    const videoBlobUrl = URL.createObjectURL(videoBlob);
    await finalizeDownload(videoBlob, `${baseFileName}${ext}`, downloadMethod, loadingBar, videoStreamedToGDrive, videoStreamedToDropbox);
    URL.revokeObjectURL(videoBlobUrl);
  }
}
