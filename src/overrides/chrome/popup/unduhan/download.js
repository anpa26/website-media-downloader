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


const downloadFileAktif = new Set();
async function downloadFile(url, mediaDiv, specificSize, silent = false, audioUrl = null) {
  const kunciDownload = `${url}::${audioUrl || ''}`;
  if (downloadFileAktif.has(kunciDownload)) return;
  downloadFileAktif.add(kunciDownload);
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}

  let selectedSubUrls = [];
  if (mediaDiv && mediaDiv.dataset.selectedSubtitles) {
      try {
          selectedSubUrls = JSON.parse(mediaDiv.dataset.selectedSubtitles);
      } catch (err) {
          console.error(err);
      }
  }

  let downloadId = null;
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

   downloadId = 'dl_' + Date.now();
   if (mediaDiv) {
     const dlBtn = mediaDiv.querySelector('#download-button');
     if (dlBtn) {
       updatePausePlayUI(dlBtn, false);
       dlBtn.style.borderRadius = '';
     }
     const cancelBtn = mediaDiv.querySelector('#cancel-button');
     if (cancelBtn) cancelBtn.style.display = 'inline-flex';
     const audioBtn = mediaDiv.querySelector('#audio-only-button');
     if (audioBtn) audioBtn.style.display = 'none';
     mediaDiv.dataset.downloadId = downloadId;
     mediaDiv.dataset.downloadMode = mediaDiv.dataset.type || (audioUrl ? 'video' : 'file');
   }

   const defaultName = mediaFilename.resolve(url, targetRequest);
    const settings = await browser.storage.local.get(['filename-template', 'disable-rename-dialog']);
    const template = (settings['filename-template'] && settings['filename-template'] !== '0') ? settings['filename-template'] : '';
    const disableRename = settings['disable-rename-dialog'] === '1';
    let finalName = defaultName;

    if (template) {
        finalName = await generateTemplateName(template, url, defaultName, targetRequest.pageTitle);
    }

    if (audioUrl) {
        let extMatch = url.match(/#(?:video|audio)\.([a-zA-Z0-9]+)$/);
        let ext = extMatch ? '.' + extMatch[1] : '.mp4';
        if (!finalName.toLowerCase().endsWith(ext)) finalName += ext;
    } else {
        let extMatch = url.match(/#[a-zA-Z0-9_]+\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
            let ext = '.' + extMatch[1];
            if (!finalName.toLowerCase().endsWith(ext)) {
                finalName += ext;
            }
        }
    }

    let newName = finalName;
    if (!silent) {
      if (!disableRename) {
        newName = await showRenameDialog(finalName);
        if (newName === null) {
            finishDownloadUI(downloadId);
            return;
        }


      }
    }

    updateDownloadingCount(1);
    let loadingBar = null;
    let statusInfo = null;
    let progressContainer = null;

    if (mediaDiv) {
      progressContainer = document.createElement('div');
      progressContainer.className = 'download-progress-container';

      loadingBar = document.createElement('mdui-linear-progress');
      statusInfo = document.createElement('div');
      statusInfo.className = 'download-status-info';

      progressContainer.appendChild(loadingBar);
      progressContainer.appendChild(statusInfo);
      mediaDiv.appendChild(progressContainer);
      prioritizeActiveDownload(mediaDiv);

      loadingBar.style.width = '100%';
      loadingBar.setAttribute('indeterminate', 'true');

      uiCache.set(downloadId, { element: mediaDiv, loadingBar, statusInfo, progressContainer });
    }

    const dlSettings = await browser.storage.local.get(['download-method', 'stream-download', 'background-download', 'skip-http-errors']);
    let downloadMethod = dlSettings['download-method'] || 'browser';
    if (url.includes('#audio.m4a') || url.includes('#audio.webm')) {
        downloadMethod = 'fetch';
    }
    let streamPref = dlSettings['stream-download'] || 'offline';
    const bgDownloadEnabled = dlSettings['background-download'] !== '0';
    const skipHttpErrorsOn = dlSettings['skip-http-errors'] === '1';

    try {
        if (!bgDownloadEnabled) throw new Error('Background download disabled');
        const isYouTube = url.toLowerCase().includes('googlevideo.com') || url.toLowerCase().includes('youtube.com') || url.toLowerCase().includes('youtu.be') || (mediaDiv && mediaDiv.dataset.originalUrl && (mediaDiv.dataset.originalUrl.toLowerCase().includes('youtube.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('googlevideo.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('youtu.be')));
        if (isYouTube) {
            const backgroundJob = await browser.runtime.sendMessage({
                action: 'startPersistentAudioJob',
                url,
                audioUrl: audioUrl && audioUrl !== 'all' ? audioUrl : null,
                filename: newName,
                isYouTube: true,
                audioOnly: false,
                request: targetRequest,
                downloadMethod
            });
            if (!backgroundJob?.success) throw new Error(backgroundJob?.error || 'Unable to start background video job');
            if (backgroundJob.jobId && mediaDiv) {
                mediaDiv.dataset.downloadId = backgroundJob.jobId;
                const cachedItem = uiCache.get(downloadId) || uiCache.get(url);
                if (cachedItem) uiCache.set(backgroundJob.jobId, cachedItem);
            }
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(browser.i18n.getMessage('downloadStarted') || 'Download started in background');
            }
            return;
        }
    } catch (err) {
        if (bgDownloadEnabled) console.warn("Failed to start persistent YouTube download, running in popup fallback:", err);
    }

    const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs[0];
    const pageUrl = activeTab ? activeTab.url : "";
    const pageTitle = activeTab ? activeTab.title : "";

    browser.runtime.sendMessage({
        action: 'addToHistory',
        item: { url, filename: newName, timestamp: Date.now(), pageUrl, pageTitle }
    });

    const subSettings = await browser.storage.local.get(['subtitle-conversion']);
    const subFormat = subSettings['subtitle-conversion'] || 'none';
    const mediaType = getMediaType(url, targetRequest.responseHeaders);
    if (mediaType === 'subtitle' && subFormat !== 'none') {
        try {
            let text;
            const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: url });
            if (bgFetch && bgFetch.text) {
                text = bgFetch.text;
            } else {
                const response = await spoofedFetch(url);
                if (!response.ok) throw new Error("Fetch failed");
                text = await response.text();
            }

            try {
                if (typeof window.subsrt !== 'undefined') {
                    text = globalThis.mediaCompute?.run
                        ? await globalThis.mediaCompute.run('subtitle-convert', { text, format: subFormat })
                        : window.subsrt.convert(text, { format: subFormat });
                } else {
                    throw new Error("subsrt not loaded");
                }
            } catch (convErr) {
                console.warn("subsrt conversion failed, using fallback:", convErr);
                if (subFormat === 'srt') {
                    if (text.trim().startsWith('WEBVTT')) {
                        text = text.replace(/^WEBVTT[^\n]*\n+/i, '');
                        text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{3})/g, '$1,$2');
                    }
                } else if (subFormat === 'vtt') {
                    if (!text.trim().startsWith('WEBVTT')) {
                        text = "WEBVTT\n\n" + text.trim();
                        text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/g, '$1.$2');
                    }
                }
            }

            newName = newName.replace(/\.[a-z0-9]+$/i, '.' + subFormat);
            if (!newName.toLowerCase().endsWith('.' + subFormat)) newName += '.' + subFormat;

            let mimeType = 'application/octet-stream';
            if (subFormat === 'srt') mimeType = 'application/x-subrip';
            if (subFormat === 'vtt') mimeType = 'text/vtt';
            const blobUrl = URL.createObjectURL(new Blob([text], {type: mimeType}));
            if (typeof finalizeDownload === 'function') {
                const blob = new Blob([text], {type: mimeType});
                await finalizeDownload(blob, newName, downloadMethod, loadingBar, false, false);
            } else {
                if (downloadMethod === 'browser') {
                    const id = await browser.downloads.download({ url: blobUrl, filename: newName, saveAs: false });
                    if (mediaDiv) mediaDiv.dataset.downloadId = id;
                } else {
                    const a = document.createElement("a");
                    a.href = blobUrl;
                    a.download = newName;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => document.body.removeChild(a), 1000);
                }
                setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            }
            finishDownloadUI(downloadId, true);
            return;
        } catch (e) {
            console.error("Subtitle conversion failed", e);
        }
    }

    if (!bgDownloadEnabled) {
        if (streamPref === 'offline') streamPref = 'stream';
    }

    const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');
    const cloudSettings = await browser.storage.local.get(['save-to-gdrive', 'save-to-dropbox']);
    const cloudEnabled = cloudSettings['save-to-gdrive'] === '1' || cloudSettings['save-to-dropbox'] === '1';

    if (audioUrl) {
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("startingDownload") || "Starting download...";
        try {

            finishDownloadUI(downloadId, true);
        } catch (e) {
            console.error("downloadFile: Muxing failed", e);
            if (e.message !== "Cancelled") showDialog(browser.i18n.getMessage("downloadError", [e.message]));
            finishDownloadUI(downloadId, false);
        }
        return;
    }

    if (isStream && !bgDownloadEnabled) {
      const selectedRes = mediaDiv ? mediaDiv.dataset.selectedResolution : '';
      if (selectedRes && mediaDiv) mediaDiv.dataset.selectedResolution = selectedRes;
      loadingBar.max = 100;
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo.textContent = browser.i18n.getMessage('preparingManifest') || 'Preparing stream...';
      let subDataStream = null;
      const pengaturanSubStream = await browser.storage.local.get(['embed-subtitles-nonyt']);
      if (pengaturanSubStream['embed-subtitles-nonyt'] === '1' && selectedSubUrls.length > 0) {
        subDataStream = [];
        for (let i = 0; i < selectedSubUrls.length; i++) {
          const subUrl = selectedSubUrls[i];
          try {
            const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: subUrl });
            let text = bgFetch && bgFetch.text ? bgFetch.text : null;
            if (!text) {
              const resp = await spoofedFetch(subUrl);
              if (resp.ok) text = await resp.text();
            }
            if (text) {
              const matchedReq = allMediaRequests.find(r => (r.bestRequest.originalUrl === subUrl || r.bestRequest.url === subUrl));
              const name = matchedReq ? (matchedReq.resolvedFilename || getFileName(subUrl)) : getFileName(subUrl);
              let lang = 'und';
              const langMatch = name.match(/[\s._-]([a-z]{2})[\s._-]/i) || name.match(/^([a-z]{2})[\s._-]/i);
              if (langMatch) lang = langMatch[1].toLowerCase();
              subDataStream.push({ text, language: lang, displayName: name.replace(/\.[a-zA-Z0-9]+$/, '') });
            }
          } catch (err) {
            console.error('Failed to fetch subtitle:', subUrl, err);
          }
        }
        if (!subDataStream.length) subDataStream = null;
      }
      const result = url.toLowerCase().includes('.mpd')
        ? await downloadMPDOffline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, false, selectedRes, subDataStream)
        : await downloadM3U8Offline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, false, selectedRes, subDataStream);
      if (window.activeCancellations.has(url)) throw new Error('Cancelled');
      finishDownloadUI(downloadId, true);
      return result;
    } else if (isStream && streamPref === 'offline') {
      const selectedRes = mediaDiv ? mediaDiv.dataset.selectedResolution : '';
      loadingBar.max = 100;
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo.textContent = browser.i18n.getMessage('preparingManifest') || 'Preparing stream...';
      let subDataStream = null;
      const pengaturanSubStream = await browser.storage.local.get(['embed-subtitles-nonyt']);
      if (pengaturanSubStream['embed-subtitles-nonyt'] === '1' && selectedSubUrls.length > 0) {
        subDataStream = [];
        for (let i = 0; i < selectedSubUrls.length; i++) {
          const subUrl = selectedSubUrls[i];
          try {
            const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: subUrl });
            let text = bgFetch && bgFetch.text ? bgFetch.text : null;
            if (!text) {
              const resp = await spoofedFetch(subUrl);
              if (resp.ok) text = await resp.text();
            }
            if (text) {
              const matchedReq = allMediaRequests.find(r => (r.bestRequest.originalUrl === subUrl || r.bestRequest.url === subUrl));
              const name = matchedReq ? (matchedReq.resolvedFilename || getFileName(subUrl)) : getFileName(subUrl);
              let lang = 'und';
              const langMatch = name.match(/[\s._-]([a-z]{2})[\s._-]/i) || name.match(/^([a-z]{2})[\s._-]/i);
              if (langMatch) lang = langMatch[1].toLowerCase();
              subDataStream.push({ text, language: lang, displayName: name.replace(/\.[a-zA-Z0-9]+$/, '') });
            }
          } catch (err) {
            console.error('Failed to fetch subtitle:', subUrl, err);
          }
        }
        if (!subDataStream.length) subDataStream = null;
      }
      const streamJob = await browser.runtime.sendMessage({
        action: 'startPersistentStreamJob', url, filename: newName,
        quality: selectedRes || 'highest', request: targetRequest, downloadMethod, subData: subDataStream
      });
      if (!streamJob?.success) throw new Error(streamJob?.error || 'Unable to start stream download');
      if (streamJob.jobId && mediaDiv) {
        mediaDiv.dataset.downloadId = streamJob.jobId;
        const itemTersimpen = uiCache.get(downloadId) || uiCache.get(url);
        if (itemTersimpen) uiCache.set(streamJob.jobId, itemTersimpen);
      }
      return;
    } else if (bgDownloadEnabled && downloadMethod === 'browser' && !cloudEnabled && !skipHttpErrorsOn) {

      let downloadUrl = url;
      try {
        const urlObj = new URL(url);
        const rangeParams = ['range', 'offset', 'start', 'end'];
        let changed = false;
        rangeParams.forEach(param => {
          if (urlObj.searchParams.has(param)) {
            urlObj.searchParams.delete(param);
            changed = true;
          }
        });
        if (changed) downloadUrl = urlObj.toString();
      } catch (e) {}

      if (downloadMethod === 'browser') {
        const id = await browser.downloads.download({
          url: downloadUrl,
          filename: newName,
          saveAs: false
        });
        if (mediaDiv) mediaDiv.dataset.downloadId = id;
      } else {

        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = newName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          finishDownloadUI(downloadId, true);
        }, 1000);
      }
    } else {

      if (!bgDownloadEnabled) {

        let showNotif = false;
        let notifId = '';
        try {
          const showNotifRes = await browser.storage.local.get('fetch-notification');
          showNotif = showNotifRes['fetch-notification'] !== '0';
          notifId = 'fetch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

          if (showNotif) {
            try {
              browser.notifications.create(notifId, {
                type: "basic",
                iconUrl: browser.runtime.getURL("icons/icon.png"),
                title: (browser.i18n.getMessage("downloadingTitle") || "Downloading..."),
                message: newName
              });
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }

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
              statusInfo.textContent = browser.i18n.getMessage("downloadPopupProgressWithSize", [percent.toString(), loadedMB, totalMB]);
            } else {
              const loadedMB = (receivedLength / 1048576).toFixed(1);
              statusInfo.textContent = browser.i18n.getMessage("downloadPopupProgressNoSize", [loadedMB]);
            }
          }

          const blob = new Blob(chunks);

          const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method'] || 'browser');
          await finalizeDownload(blob, newName, downloadMethod, loadingBar, false, false);

          if (showNotif) {
            try {
              browser.notifications.clear(notifId);
              const completeId = notifId + '_complete';
              browser.notifications.create(completeId, {
                type: "basic",
                iconUrl: browser.runtime.getURL("icons/icon.png"),
                title: browser.i18n.getMessage("downloadCompleteTitle") || "Download completed",
                message: newName
              });
              setTimeout(() => {
                try { browser.notifications.clear(completeId); } catch (e) {}
              }, 5000);
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }

          finishDownloadUI(downloadId, true);
        } catch (e) {
          console.error("Popup fetch error:", e);
          if (showNotif && notifId) {
            try {
              browser.notifications.clear(notifId);
              if (e.message !== "Cancelled") {
                browser.notifications.create(notifId + '_error', {
                  type: "basic",
                  iconUrl: browser.runtime.getURL("icons/icon.png"),
                  title: "Download failed",
                  message: e.message
                });
              }
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }
          if (e.message !== "Cancelled") showDialog(browser.i18n.getMessage("downloadError", [e.message]));
          finishDownloadUI(downloadId);
        }
      } else {

        browser.runtime.sendMessage({
          action: 'startFetchDownload',
          url: url,
          downloadId: mediaDiv ? mediaDiv.dataset.downloadId : downloadId,
          filename: newName,
          request: targetRequest,
          mediaType: mediaDiv ? mediaDiv.dataset.type : getMediaType(url, targetRequest.responseHeaders)
        });
      }
    }  } catch (error) {
    let errMsg = error.message;
    if (error.message && error.message.includes("Extension context invalidated")) {
        errMsg = "Extension context invalidated. Please reload the page to continue using the downloader.";
    }
    try {
        showDialog(browser.i18n.getMessage("downloadError", [errMsg]) || errMsg);
    } catch (e) {
        showDialog(errMsg);
    }
    if (downloadId) finishDownloadUI(downloadId);
  } finally {
    if (window.activeCancellations) {
        window.activeCancellations.delete(url);
        if (audioUrl) window.activeCancellations.delete(audioUrl);
        if (downloadId) window.activeCancellations.delete(downloadId);

        const restoreCb = window.activeCancellations.restoreCallbacks.get(url);
        if (restoreCb) restoreCb();
        window.activeCancellations.restoreCallbacks.delete(url);
    }
    if (wakeLock) wakeLock.release();
    downloadFileAktif.delete(kunciDownload);
  }
}
