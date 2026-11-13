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



async function downloadAudioOnly(url, mediaDiv, specificSize) {
  const kunciDownloadAudio = `audio-only::${url}`;
  if (downloadFileAktif.has(kunciDownloadAudio)) return;
  downloadFileAktif.add(kunciDownloadAudio);
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

   const defaultName = mediaFilename.resolve(url, targetRequest);
   const settings = await browser.storage.local.get(['filename-template', 'disable-rename-dialog']);
   const template = (settings['filename-template'] && settings['filename-template'] !== '0') ? settings['filename-template'] : '';
   const disableRename = settings['disable-rename-dialog'] === '1';
   let finalName = defaultName;

   if (template) {
       finalName = await generateTemplateName(template, url, defaultName, targetRequest.pageTitle);
   }


   const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');
   let audioExt = settings['audio-to-mp3'] === '1' ? ".mp3" : (url.toLowerCase().includes('.mpd') ? ".m4a" : ".wav");

   finalName = mediaFilename.changeExtension(finalName, audioExt);

   let newName = finalName;
   if (!disableRename) {
       newName = await showRenameDialog(finalName);
       if (newName === null) return;
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
            const isYouTube = url.toLowerCase().includes('googlevideo.com') || url.toLowerCase().includes('youtube.com') || url.toLowerCase().includes('youtu.be') || (mediaDiv && mediaDiv.dataset.originalUrl && (mediaDiv.dataset.originalUrl.toLowerCase().includes('youtube.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('googlevideo.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('youtu.be')));
            const response = await browser.tabs.sendMessage(activeTab.id, { action: 'ping' }).catch(() => null);
            if (response && response.pong) {
                const backgroundJob = await browser.runtime.sendMessage({
                    action: 'startPersistentAudioJob',
                    url: url,
                    filename: newName,
                    isYouTube: isYouTube,
                    audioOnly: true,
                    directAudioSource: false,
                    encodeM4aToMp3: false,
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
                  action: 'startPersistentStreamJob', url, filename: newName,
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


          let blob;
          if (false) {
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
          await extractAudioFromBlob(blob, newName, downloadMethod, loadingBar, checkCancel);
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
    if (wakeLock) wakeLock.release();
  }
}
