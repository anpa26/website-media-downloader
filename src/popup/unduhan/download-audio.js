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



async function downloadAudioOnly(url, mediaDiv, specificSize, recoveredFilename = null) {
  const kunciDownloadAudio = `audio-only::${url}`;
  if (downloadFileAktif.has(kunciDownloadAudio)) return;
  downloadFileAktif.add(kunciDownloadAudio);
  let recoveryJobId = null;
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}

  if (window.activeCancellations) {
      window.activeCancellations.delete(url);
  }

  try {
   const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url });
   let targetRequest = requests[url]?.find(r => r.size === specificSize) || requests[url]?.[0];

   if (!targetRequest && mediaDiv && mediaDiv.dataset.originalUrl) {
       const ogUrl = mediaDiv.dataset.originalUrl;
       const ogReqs = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: ogUrl });
       targetRequest = ogReqs[ogUrl]?.[0];
   }

   if (!targetRequest) {
       console.warn("Target request metadata not found, using generic fallback.");
       targetRequest = { responseHeaders: [] };
   }

   const settings = await browser.storage.local.get(['filename-template', 'disable-rename-dialog', 'audio-to-mp3']);
   const initialIsYouTube = /(?:googlevideo\.com|youtube\.com|youtu\.be)/i.test(url) ||
       !!(mediaDiv && mediaDiv.dataset.originalUrl && /(?:youtube\.com|googlevideo\.com|youtu\.be)/i.test(mediaDiv.dataset.originalUrl));
   if (initialIsYouTube) {
       const originalPageUrl = targetRequest.pageUrl || targetRequest.tabUrl || '';
       const originalTitle = targetRequest.pageTitle || '';
       const m4aCandidates = Object.entries(requests).filter(([candidateUrl, candidateRequests]) => {
           const decoded = decodeURIComponent(candidateUrl).toLowerCase();
           if (!(decoded.includes('#audio.m4a') || decoded.includes('mime=audio/mp4'))) return false;
           const candidate = candidateRequests?.[0] || {};
           if (originalPageUrl && (candidate.pageUrl || candidate.tabUrl)) {
               return (candidate.pageUrl || candidate.tabUrl) === originalPageUrl;
           }
           return !originalTitle || !candidate.pageTitle || candidate.pageTitle.startsWith(originalTitle);
       });
       const getAudioBitrate = ([candidateUrl, candidateRequests]) => {
           const candidate = candidateRequests?.[0] || {};
           const metadataBitrate = Number(candidate.audioBitrate || candidate.bitrate || 0);
           if (metadataBitrate > 0) return metadataBitrate;

           try {
               const parsed = new URL(candidateUrl.split('#')[0]);
               const urlBitrate = Number(parsed.searchParams.get('bitrate') || parsed.searchParams.get('abr') || 0);
               if (urlBitrate > 0) return urlBitrate;

               const itag = Number(parsed.searchParams.get('itag') || 0);
               const knownM4aBitrates = {
                   139: 48000,
                   140: 128000,
                   141: 256000,
                   256: 192000,
                   258: 384000,
                   325: 256000,
                   328: 256000
               };
               return knownM4aBitrates[itag] || 0;
           } catch (error) {
               return 0;
           }
       };
       m4aCandidates.sort((a, b) => {
           const bitrateDifference = getAudioBitrate(b) - getAudioBitrate(a);
           if (bitrateDifference !== 0) return bitrateDifference;
           const aReq = a[1]?.[0] || {};
           const bReq = b[1]?.[0] || {};
           return Number(bReq.size || bReq.contentLength || 0) - Number(aReq.size || aReq.contentLength || 0);
       });
       if (m4aCandidates.length > 0) {
           url = m4aCandidates[0][0];
           targetRequest = m4aCandidates[0][1]?.[0] || targetRequest;
           specificSize = targetRequest.size || specificSize;
       }
   }

   const defaultName = mediaFilename.resolve(url, targetRequest);
const template = (settings['filename-template'] && settings['filename-template'] !== '0') ? settings['filename-template'] : '';
   const disableRename = settings['disable-rename-dialog'] === '1';
   let finalName = defaultName;

   if (template) {
       finalName = await generateTemplateName(template, url, defaultName, targetRequest.pageTitle);
   }


   const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');
   let audioExt = settings['audio-to-mp3'] === '1' ? ".mp3" : (url.toLowerCase().includes('.mpd') ? ".m4a" : ".wav");

   finalName = mediaFilename.changeExtension(finalName, audioExt);

   let newName = recoveredFilename || finalName;
   if (!disableRename && !recoveredFilename) {
       newName = await showRenameDialog(finalName);
       if (newName === null) return;
   }

   const isYouTubeSource = url.toLowerCase().includes('googlevideo.com') ||
       url.toLowerCase().includes('youtube.com') ||
       url.toLowerCase().includes('youtu.be') ||
       (mediaDiv && mediaDiv.dataset.originalUrl && /(?:youtube\.com|googlevideo\.com|youtu\.be)/i.test(mediaDiv.dataset.originalUrl));
   const isYouTubeAudioSource = isYouTubeSource && (
       (mediaDiv && mediaDiv.dataset.audioUrl === url) ||
       /(?:mime=audio|#audio)/i.test(decodeURIComponent(url))
   );
   const shouldEncodeMp3 = isYouTubeAudioSource && settings['audio-to-mp3'] === '1';
   const shouldEncodeDirectMp3 = settings['audio-to-mp3'] === '1' && !isStream;
   const directAudioSource = isYouTubeAudioSource && !shouldEncodeMp3;

   if (directAudioSource) {
       newName = newName.replace(/\.wav$/i, '.mov');
   }



    if (mediaDiv) {
      mediaDiv.dataset.downloadMode = 'audio';
      const audioBtn = mediaDiv.querySelector('#audio-only-button');
      const dlBtn = mediaDiv.querySelector('#download-button');
      const cancelBtn = mediaDiv.querySelector('#cancel-button');
      if (audioBtn) audioBtn.style.display = 'none';
      if (dlBtn) { updatePausePlayUI(dlBtn, false); dlBtn.style.borderRadius = ""; }
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    }

    recoveryJobId = await rememberPopupDownload('audio', url, mediaDiv, targetRequest, newName, { specificSize });
    updateDownloadingCount(1);
    const progressContainer = document.createElement('div');
    progressContainer.className = 'download-progress-container';

    const loadingBar = document.createElement('mdui-linear-progress');
    const statusInfo = document.createElement('div');
    statusInfo.className = 'download-status-info';

    progressContainer.appendChild(loadingBar);
    progressContainer.appendChild(statusInfo);
    mediaDiv.appendChild(progressContainer);
    prioritizeActiveDownload(mediaDiv);

    loadingBar.style.width = '100%';
    loadingBar.setAttribute('indeterminate', 'true');

    uiCache.set(url, { element: mediaDiv, loadingBar, statusInfo, progressContainer });

    const dlSettings = await browser.storage.local.get(['download-method', 'stream-download', 'background-download']);
    let downloadMethod = dlSettings['download-method'] || 'browser';
    let streamPref = dlSettings['stream-download'] || 'offline';
    const bgDownloadEnabled = dlSettings['background-download'] !== '0';

try {
        if (!bgDownloadEnabled) throw new Error('Background download disabled');
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
            const response = await browser.tabs.sendMessage(activeTab.id, { action: 'ping' }).catch(() => null);
            if (response && response.pong && !isStream) {
                const backgroundJob = await browser.runtime.sendMessage({
                    action: 'startPersistentAudioJob', recoveryJobId,
                    url: url,
                    filename: newName,
                    isYouTube: isYouTubeSource,
                    audioOnly: true,
                    directAudioSource,
                    encodeM4aToMp3: shouldEncodeDirectMp3,
                    request: targetRequest
                });
                if (!backgroundJob?.success) throw new Error(backgroundJob?.error || 'Unable to start background audio job');
                if (backgroundJob.jobId && mediaDiv) {
                    mediaDiv.dataset.downloadId = backgroundJob.jobId;
                    const cachedItem = uiCache.get(url);
                    if (cachedItem) uiCache.set(backgroundJob.jobId, cachedItem);
                }
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    tampilnoNotif(browser.i18n.getMessage("downloadStarted") || "Download started in background tab");
                }
                return;
            }
        }
    } catch (err) {
        if (bgDownloadEnabled) console.warn("Failed to delegate to tab content script, running in popup fallback:", err);
    }

    if (!bgDownloadEnabled) {
        if (streamPref === 'offline') streamPref = 'stream';
    }

   const selectedRes = mediaDiv ? mediaDiv.dataset.selectedResolution : '';
   if (isStream) {
      if (url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd')) {
          if (streamPref === 'offline') {
              loadingBar.max = 100;
              loadingBar.setAttribute('indeterminate', 'true');
              statusInfo.textContent = browser.i18n.getMessage('preparingManifest') || 'Preparing stream...';
              const streamJob = await browser.runtime.sendMessage({
                  action: 'startPersistentStreamJob', recoveryJobId, url, filename: newName,
                  quality: selectedRes || 'highest', audioOnly: true,
                  request: targetRequest, downloadMethod
              });
              if (!streamJob?.success) throw new Error(streamJob?.error || 'Unable to start stream download');
              return;
          }
          const result = url.toLowerCase().includes('.mpd')
            ? await downloadMPDOffline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, true, selectedRes)
            : await downloadM3U8Offline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, true, selectedRes);
          if (window.activeCancellations.has(url)) throw new Error("Cancelled");

          finishDownloadUI(url, true);
          return;
      } else {
          showDialog(browser.i18n.getMessage("audioExtractionNotSupported"), browser.i18n.getMessage("notSupportedTitle"));
          finishDownloadUI(url);
          return;
      }
   } else {
      try {
          const checkCancel = () => window.activeCancellations && window.activeCancellations.has(url);
          const isYouTube = url.toLowerCase().includes('googlevideo.com') || url.toLowerCase().includes('youtube.com') || url.toLowerCase().includes('youtu.be') || (mediaDiv && mediaDiv.dataset.originalUrl && (mediaDiv.dataset.originalUrl.toLowerCase().includes('youtube.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('googlevideo.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('youtu.be')));

          let blob;
          if (isYouTube) {
              const uint8Array = await window.fetchAsUint8ArrayChunked(url, loadingBar, statusInfo, checkCancel);
              blob = new Blob([uint8Array.buffer]);
          } else {
              const response = await spoofedFetch(url);
              if (!response.ok) {
                if (await shouldSkipHttpError(response.status)) { handleSkippedHttpError(url, response.status); return; }
                throw new Error(`HTTP error! status: ${response.status}`);
              }

              const contentLength = +(response.headers.get('Content-Length') || 0);
              const reader = response.body.getReader();
              let receivedLength = 0;
              let chunks = [];

              loadingBar.removeAttribute('indeterminate');
              if (contentLength > 0) loadingBar.max = contentLength;

              while(true) {
                while (window.activePauses && (window.activePauses.has(url) || (mediaDiv?.dataset?.downloadId && window.activePauses.has(mediaDiv.dataset.downloadId)))) { await new Promise(r => setTimeout(r, 200)); }
                if (window.activeCancellations.has(url)) {
                  reader.cancel();
                  throw new Error("Cancelled");
                }
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedLength += value.length;

                if (contentLength > 0) {
                    loadingBar.value = receivedLength;
                    const percent = Math.round((receivedLength / contentLength) * 100);
                    const loadedMB = (receivedLength / 1048576).toFixed(1);
                    const totalMB = (contentLength / 1048576).toFixed(1);
                    statusInfo.textContent = browser.i18n.getMessage("downloadProgressWithSize", [percent.toString(), loadedMB, totalMB]) || `Downloading: ${percent}% (${loadedMB}MB / ${totalMB}MB)`;
                } else {
                    const loadedMB = (receivedLength / 1048576).toFixed(1);
                    statusInfo.textContent = browser.i18n.getMessage("downloadProgressNoSize", [loadedMB]) || `Downloading: ${loadedMB}MB`;
                }
              }
              blob = new Blob(chunks);
          }
          statusInfo.textContent = browser.i18n.getMessage("downloadCompletePreparingExtraction");
          await new Promise(r => setTimeout(r, 500));
          if (window.activeCancellations.has(url)) throw new Error("Cancelled");
          if (directAudioSource) {
              const movBlob = new Blob([blob], { type: 'video/quicktime' });
              await finalizeDownload(movBlob, newName, downloadMethod, loadingBar, false, false);
          } else if (shouldEncodeDirectMp3) {
              const result = await convertM4aToMp3Direct(blob, newName, loadingBar, checkCancel);
              await finalizeDownload(result.blob, result.filename, downloadMethod, loadingBar, false, false);
          } else {
              await extractAudioFromBlob(blob, newName, downloadMethod, loadingBar, checkCancel);
          }
      } catch (e) {
          throw new Error(e.message === "Cancelled" ? "Cancelled" : browser.i18n.getMessage("downloadError", [e.message]));
      }
   }
   finishDownloadUI(url, true);
  } catch (error) {
    if (error.message !== "Cancelled") {
      showDialog(browser.i18n.getMessage("audioExtractionError", [error.message]));
    }
    finishDownloadUI(url);
  } finally {
    downloadFileAktif.delete(kunciDownloadAudio);
    const restoreCb = window.activeCancellations.restoreCallbacks.get(url);
    if (restoreCb) restoreCb();
    window.activeCancellations.restoreCallbacks.delete(url);
    window.activeCancellations.delete(url);
    await forgetPopupDownload(recoveryJobId);
    if (wakeLock) wakeLock.release();
  }
}
