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



const statusPopupPungkasan = new Map();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender && sender.id && sender.id !== browser.runtime.id) return;
  if (message.action === 'imageMetadataUpdated') {
    if (document.getElementById('navbar')?.value === 'home') updateMissingImageSizes(message.urls).catch(() => {});
    return;
  }
  if (message.action === 'mediaRemovedOnTabClose') {
    if (document.getElementById('navbar')?.value === 'home') {
      loadMediaList().catch(() => {});
    } else {
      navigationPageLoads.delete('home');
    }
    return;
  }
  if (message.action === 'audioJobUpdate' && message.complete) {
    finishDownloadUI(message.jobId, !!message.success);
    hideGlobalProgressIfMatch(message.jobId);
    sendResponse({ success: true });
    return;
  }
  if (message.action === 'customStatus' || message.action === 'audioPopupStatus' || message.action === 'streamPopupStatus') {
    if (message.action === 'audioPopupStatus' || message.action === 'streamPopupStatus') {
      const kunciJobStatus = String(message.jobId || message.id);
      const persenStatus = message.percent !== undefined && message.percent !== null && !isNaN(message.percent) ? Math.round(Number(message.percent)) : null;
      const teksStatus = message.text || '';
      const terminalStatus = (persenStatus !== null && persenStatus >= 100) || /selesai|complete|gagal|error|failed|batal|cancel/i.test(teksStatus);
      if (terminalStatus) {
        statusPopupPungkasan.delete(kunciJobStatus);
      } else {
        const sidikStatus = [persenStatus, teksStatus, !!message.isPaused, !!message.indeterminate].join('|');
        if (statusPopupPungkasan.get(kunciJobStatus) === sidikStatus) {
          sendResponse({ success: true });
          return;
        }
        statusPopupPungkasan.set(kunciJobStatus, sidikStatus);
      }
    }
    let item = uiCache.get(message.id);
    if (!item) {
      const mediaItems = document.querySelectorAll('.media-item');
      for (const el of mediaItems) {
        if (el.dataset.downloadId === message.id || el.dataset.url === message.id || (message.jobId && el.dataset.downloadId === message.jobId)) {
          let progressContainer = el.querySelector('.download-progress-container');
          if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.className = 'download-progress-container';
            el.appendChild(progressContainer);
          }

          let loadingBar = progressContainer.querySelector('mdui-linear-progress');
          if (!loadingBar) {
            loadingBar = document.createElement('mdui-linear-progress');
            progressContainer.appendChild(loadingBar);
          }

          let statusInfo = progressContainer.querySelector('.download-status-info');
          if (!statusInfo) {
            statusInfo = document.createElement('div');
            statusInfo.className = 'download-status-info';
            progressContainer.appendChild(statusInfo);
          }

          const dlBtn = el.querySelector('#download-button');
          const audioBtn = el.querySelector('#audio-only-button');
          const prvBtn = el.querySelector('mdui-segmented-button:not(#download-button):not(#audio-only-button):not(#cancel-button)');
          const cancelBtn = el.querySelector('#cancel-button');

          item = { loadingBar, statusInfo, element: el, progressContainer, dlBtn, audioBtn, prvBtn, cancelBtn };
          uiCache.set(message.id, item);
          if (message.jobId) uiCache.set(message.jobId, item);
          if (el.dataset.downloadId) uiCache.set(el.dataset.downloadId, item);
          if (el.dataset.url) uiCache.set(el.dataset.url, item);
          break;
        }
      }
    }
    if (item) {
        if (message.jobId) item.element.dataset.downloadId = message.jobId;
        if (!activeDownloadingElements.includes(item.element)) {
            prioritizeActiveDownload(item.element);
        }
        if (item.dlBtn) {
            if (item.cancelBtn) item.cancelBtn.style.display = 'inline-flex';
            item.dlBtn.style.borderRadius = '';
            if (item.audioBtn) item.audioBtn.style.display = 'none';
        }
        if (message.text && item.statusInfo) item.statusInfo.textContent = message.text;
        if (message.percent !== undefined) {
            item.loadingBar.removeAttribute('indeterminate');
            item.loadingBar.max = 100;
            item.loadingBar.value = Math.round(Number(message.percent));
        } else if (message.indeterminate) {
            item.loadingBar.setAttribute('indeterminate', 'true');
        }
        let gType = item.element?.dataset?.downloadMode;
        const grupKuwat = !!gType;
        if (!gType) {
          if (message.audioOnly || message.action === 'audioPopupStatus') gType = 'audio';
          else if (message.action === 'streamPopupStatus') gType = 'stream';
          else gType = item.element?.dataset?.type || message.mediaType || 'stream';
        }
        let fName = item.element?.querySelector(".media-headline")?.textContent?.trim() ||
                    item.element?.querySelector(".media-title")?.textContent?.trim() ||
                    item.element?.dataset?.filename?.trim();
        if (!fName && message.id) {
          try {
            const u = new URL(String(message.id).startsWith("http") ? message.id : (item.element?.dataset?.url || ""));
            const cleanPath = u.pathname.split("/").filter(Boolean).pop();
            if (cleanPath) fName = decodeURIComponent(cleanPath);
          } catch (e) {}
        }
        const effectiveId = message.jobId || item.element?.dataset?.downloadId || String(message.id);
        const kunciLawasStatus = golekKunciProgresGrup([String(effectiveId), message.jobId, String(message.id), item.element?.dataset?.url], item.element);
        const entriLawasStatus = kunciLawasStatus ? activeGroupDownloads.get(kunciLawasStatus) : null;
        const resolvedIsPaused = message.isPaused !== undefined ? !!message.isPaused : (entriLawasStatus?.isPaused ?? false);
        const { groupTypeLawas } = simpenProgresGrup({
          id: effectiveId,
          jobId: message.jobId || null,
          url: item.element?.dataset?.url || (String(message.id).startsWith('http') ? String(message.id) : null),
          groupType: gType,
          filename: fName || "Media File",
          percent: message.percent !== undefined && message.percent !== null ? Math.round(Number(message.percent)) : null,
          indeterminate: !!message.indeterminate,
          text: message.text || "",
          isPaused: resolvedIsPaused,
          el: item.element
        }, item.element, grupKuwat);
        syncGroupProgressCard(gType);
        groupTypeLawas.forEach(syncGroupProgressCard);
    }
    const ctlId = message.jobId || item?.element?.dataset?.downloadId || message.id;
    updateGlobalOperationBar({
      id: ctlId,
      url: message.id,
      text: message.text || 'Downloading...',
      percent: message.percent,
      indeterminate: message.indeterminate
    });
    sendResponse({ success: true });
    return;
  }
  if (message.action === 'downloadProgress') {
    updateProgressUI(message.id || message.url, message.loaded, message.total, message.isParallel, message.isPaused, message.status, message.percent, message.finishedParts, message.totalParts);
    const pct = message.percent !== undefined && message.percent !== null ? message.percent : (message.total > 0 ? (message.loaded / message.total) * 100 : null);
    updateGlobalOperationBar({
      id: message.id || message.url,
      url: message.url,
      text: message.status === 'uploading' ? (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") : (browser.i18n.getMessage("downloadingTitle") || "Downloading..."),
      percent: pct,
      indeterminate: !(message.total > 0) && pct === null,
      isPaused: !!message.isPaused
    });
  } else if (message.action === 'downloadPaused') {
    updateProgressUI(message.id, message.loaded, message.total, false, true);
    const kunciPause = golekKunciProgresGrup([String(message.id), message.url], null);
    const targetGroupItem = kunciPause ? activeGroupDownloads.get(kunciPause) : null;
    if (targetGroupItem) {
      targetGroupItem.isPaused = true;
      syncGroupProgressCard(targetGroupItem.groupType);
    }
    if (!(isGroupingEnabled && isGroupProgressEnabled && activeGroup === null)) {
      const gC = document.getElementById('global-progress-container');
      const gPause = document.getElementById('pause-global-operation');
      if (gC && gC.dataset.activeId === String(message.id)) {
        gC.dataset.paused = '1';
        if (gPause) setGlobalPauseIcon(gPause, true);
      }
    } else {
      const zipDiPause = zipProgressPerJob.get(String(message.id)) || (zipProgressPerJob.size === 1 ? [...zipProgressPerJob.values()][0] : null);
      if (zipDiPause) {
        zipDiPause.isPaused = true;
        syncZipProgressToGroupCards(zipDiPause.text, zipDiPause.percent, zipDiPause.indeterminate, zipDiPause.cancelCb, true, zipDiPause.pauseCb, zipDiPause.groupType ?? null, zipDiPause.jobId ?? null);
      }
    }
  } else if (message.action === 'zipProgress') {
    const progressContainer = document.getElementById('global-progress-container');
    const progressBar = document.getElementById('global-progress-bar');
    const progressText = document.getElementById('global-progress-text');
    const cancelGlobalBtn = document.getElementById('cancel-global-operation');
    const pauseGlobalBtn = document.getElementById('pause-global-operation');
    const inGroupOverview = isGroupingEnabled && isGroupProgressEnabled && activeGroup === null;

    if (!inGroupOverview) {
      progressContainer.style.display = 'flex';
    } else {
      progressContainer.style.display = 'none';
    }
    progressBar.value = (message.total > 0) ? (message.loaded / message.total) * 100 : 0;
    if (!(message.total > 0)) progressBar.setAttribute('indeterminate', '');
    if (cancelGlobalBtn) {
      cancelGlobalBtn.style.display = 'inline-block';
      cancelGlobalBtn.onclick = () => {
        browser.runtime.sendMessage({ action: 'cancelDownload', id: message.id }).catch(() => {});
        progressContainer.style.display = 'none';
        clearZipProgressFromGroupCards(message.id);
      };
    }
    if (pauseGlobalBtn && !inGroupOverview) {
      pauseGlobalBtn.style.display = 'inline-flex';
      setGlobalPauseIcon(pauseGlobalBtn, !!message.isPaused);
      if (progressContainer) {
        progressContainer.dataset.activeId = String(message.id);
        progressContainer.dataset.paused = message.isPaused ? '1' : '0';
      }
      pauseGlobalBtn.onclick = () => {
        const paused = progressContainer?.dataset.paused === '1';
        browser.runtime.sendMessage({ action: paused ? 'resumeActiveDownload' : 'pauseDownload', id: message.id }).catch(() => {});
        if (progressContainer) progressContainer.dataset.paused = paused ? '0' : '1';
        setGlobalPauseIcon(pauseGlobalBtn, !paused);
      };
    }

    let zipText = '';
    if (message.status === 'downloading') {
      zipText = (message.isPaused ? `[${(browser?.i18n?.getMessage?.("pausedStatus") || chrome?.i18n?.getMessage?.("pausedStatus")) || "Paused"}] ` : "") + browser.i18n.getMessage("zipDownloading", [(message.loaded + 1).toString(), message.total.toString(), message.currentFile]);
      progressText.textContent = zipText;
    } else if (message.status === 'generating') {
      progressBar.value = 95;
      zipText = (message.isPaused ? `[${(browser?.i18n?.getMessage?.("pausedStatus") || chrome?.i18n?.getMessage?.("pausedStatus")) || "Paused"}] ` : "") + (browser.i18n.getMessage("zipGenerating") || "Generating ZIP archive...");
      progressText.textContent = zipText;
    } else if (message.status === 'uploading') {
      progressBar.indeterminate = message.percent === undefined;
      if (message.percent !== undefined) progressBar.value = message.percent;
      const statusText = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...");
      zipText = (message.isPaused ? `[${(browser?.i18n?.getMessage?.("pausedStatus") || chrome?.i18n?.getMessage?.("pausedStatus")) || "Paused"}] ` : "") + statusText + (message.percent !== undefined ? ` (${message.percent}%)` : "");
      progressText.textContent = zipText;
    } else if (message.status === 'processingStream') {
      progressBar.indeterminate = message.percent === undefined || message.indeterminate;
      if (message.percent !== undefined) progressBar.value = message.percent;
      zipText = `${message.currentFile || ''}${message.currentFile ? ' • ' : ''}${message.text || 'Processing stream...'}`;
      progressText.textContent = zipText;
    }

    if (inGroupOverview && zipText) {
      const pct = (message.loaded / message.total) * 100;
      const isIndet = isNaN(pct) || !isFinite(pct);
      const isPaused = !!message.isPaused;
      const cancelCb = () => {
        browser.runtime.sendMessage({ action: 'cancelDownload', id: message.id }).catch(() => {});
        clearZipProgressFromGroupCards(message.id);
      };
      const pauseCb = () => {
        const zipSaiki = zipProgressPerJob.get(String(message.id));
        const nowPaused = !(zipSaiki?.isPaused);
        browser.runtime.sendMessage({ action: nowPaused ? 'pauseDownload' : 'resumeActiveDownload', id: message.id }).catch(() => {});
        if (zipSaiki) {
          zipSaiki.isPaused = nowPaused;
          syncZipProgressToGroupCards(zipSaiki.text, zipSaiki.percent, zipSaiki.indeterminate, zipSaiki.cancelCb, nowPaused, pauseCb, zipSaiki.groupType ?? null, zipSaiki.jobId ?? null);
        }
      };
      let zipGT = message.groupType || zipProgressPerJob.get(String(message.id))?.groupType || null;
      if (!zipGT) {
        const gtSet = new Set();
        for (const [, entry] of activeGroupDownloads) { if (entry.groupType) gtSet.add(entry.groupType); }
        if (gtSet.size === 1) zipGT = [...gtSet][0];
      }
      syncZipProgressToGroupCards(`📦 ZIP • ${zipText}`, isIndet ? 0 : pct, isIndet, cancelCb, isPaused, pauseCb, zipGT, message.id);
    }
  } else if (message.action === 'zipComplete') {
    const progressContainer = document.getElementById('global-progress-container');
    const progressBar = document.getElementById('global-progress-bar');
    const progressText = document.getElementById('global-progress-text');
    const cancelGlobalBtn = document.getElementById('cancel-global-operation');

    if (cancelGlobalBtn) cancelGlobalBtn.style.display = 'none';
    progressBar.value = 1;
    progressBar.indeterminate = false;

    let completeText = '';
    if (message.cloud) {
       let successMsg = browser.i18n.getMessage("uploadSuccessGDrive", [message.filename]) || `Successfully saved ${message.filename} to Google Drive!`;
       if (message.cloud === 'dropbox') {
           successMsg = successMsg.replace(/Google Drive/g, "Dropbox");
       }
       progressText.textContent = successMsg;
       completeText = successMsg;
    } else {
       completeText = browser.i18n.getMessage("zipComplete");
       progressText.textContent = completeText;
    }

    if (isGroupingEnabled && isGroupProgressEnabled && activeGroup === null) {
      syncZipProgressToGroupCards(`📦 ZIP • ${completeText}`, 100, false, null, false, null, zipProgressPerJob.get(String(message.id))?.groupType ?? null, message.id);
    }
    setTimeout(() => {
      progressContainer.style.display = 'none';
      clearZipProgressFromGroupCards(message.id);
    }, 3000);
  } else if (message.action === 'zipError') {
    const progressContainer = document.getElementById('global-progress-container');
    const progressText = document.getElementById('global-progress-text');
    const cancelGlobalBtn = document.getElementById('cancel-global-operation');

    if (cancelGlobalBtn) cancelGlobalBtn.style.display = 'none';
    if (message.error === 'USER_CANCELED') {
      progressContainer.style.display = 'none';
      clearZipProgressFromGroupCards(message.id);
    } else {
      const errText = browser.i18n.getMessage("zipError", [message.error]);
      progressText.textContent = errText;
      if (isGroupingEnabled && isGroupProgressEnabled && activeGroup === null) {
        syncZipProgressToGroupCards(`📦 ZIP Error: ${message.error || ''}`, 0, false, null, false, null, zipProgressPerJob.get(String(message.id))?.groupType ?? null, message.id);
      }
      setTimeout(() => {
        progressContainer.style.display = 'none';
        clearZipProgressFromGroupCards(message.id);
      }, 5000);
    }
  } else if (message.action === 'confirmZipSkip') {
    showConfirmDialog(
      browser.i18n.getMessage("zipDownloadError", [message.filename, message.error || ""]),
      browser.i18n.getMessage("downloadErrorTitle") || "Download Error"
    ).then(result => {
      browser.runtime.sendMessage({ action: 'confirmZipSkipResponse', result: result });
    });
    return true;
  } else if (message.action === 'downloadComplete') {
    const dlId = message.id || message.url;
    finishDownloadUI(dlId, true);
    hideGlobalProgressIfMatch(dlId, message.url, message.jobId);

    if (message.url && message.url !== dlId) {
      finishDownloadUI(message.url, true);
    }

    if (message.url) {
      allMediaRequests = allMediaRequests.filter(item => item.bestRequest.originalUrl !== message.url);
      allFilteredRequests = allFilteredRequests.filter(item => item.bestRequest.originalUrl !== message.url);
    }
    segarkanHitunganGrup();
  } else if (message.action === 'skipHttpError') {
    const skipUrl = message.url;
    allMediaRequests = allMediaRequests.filter(item => item.bestRequest.originalUrl !== skipUrl);
    allFilteredRequests = allFilteredRequests.filter(item => item.bestRequest.originalUrl !== skipUrl);
    const skipEl = document.querySelector(`.media-item[data-url="${CSS.escape(skipUrl)}"]`);
    if (skipEl) { skipEl.remove(); kurangiRenderedCount(1); }
    finishDownloadUI(skipUrl, false);
    if (typeof mdui !== 'undefined' && mdui.snackbar) {
      tampilnoNotif(`Skipped (HTTP ${message.status || '4xx'}): ${skipUrl.split('/').pop() || skipUrl}`);
    }
  } else if (message.action === 'downloadError') {
    const id = message.id || message.url;
    const itemData = uiCache.get(id);

    finishDownloadUI(id, false);
    hideGlobalProgressIfMatch(id, message.url, message.jobId);

    if (!itemData && !document.querySelector(`.media-item[data-url="${message.url}"]`)) {
      console.debug("Ignored background download error for untracked item:", message.url);
      return;
    }

    if (message.error === "USER_CANCELED") {
      if (typeof mdui !== 'undefined' && mdui.snackbar) {
        tampilnoNotif(browser.i18n.getMessage("downloadCancelled") || "Download cancelled");
      }
      finishDownloadUI(id, false);
      return;
    }

    if (typeof mdui !== 'undefined' && mdui.snackbar) {
      tampilnoNotif(browser.i18n.getMessage("downloadError", [message.error]) || ("Download error: " + message.error));
    } else {
      showDialog(browser.i18n.getMessage("downloadError", [message.error]) || ("Download error: " + message.error));
    }
  }
});
