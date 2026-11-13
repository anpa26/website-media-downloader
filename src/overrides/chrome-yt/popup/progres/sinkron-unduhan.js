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



let activeDownloadSnapshot = null;
let activeDownloadSnapshotTime = 0;
let activeDownloadSnapshotRead = null;
function getActiveDownloadSnapshot() {
  if (activeDownloadSnapshotRead) return activeDownloadSnapshotRead;
  if (activeDownloadSnapshot && Date.now() - activeDownloadSnapshotTime < 500) {
    return Promise.resolve(activeDownloadSnapshot);
  }
  activeDownloadSnapshotRead = Promise.all([
    browser.runtime.sendMessage({ action: 'getActiveDownloads' }).catch(() => null),
    browser.tabs.query({ active: true, currentWindow: true }).then(async tabs => {
      const tab = tabs[0];
      if (!tab?.url?.startsWith('http')) return null;
      return browser.tabs.sendMessage(tab.id, { action: 'get_active_downloads' }).catch(() => null);
    }).catch(() => null)
  ]).then(([background, tab]) => {
    activeDownloadSnapshot = { ...tab, ...background };
    activeDownloadSnapshotTime = Date.now();
    return activeDownloadSnapshot;
  }).finally(() => { activeDownloadSnapshotRead = null; });
  return activeDownloadSnapshotRead;
}

let activeDownloadUISync = null;
function restoreActiveDownloadsUI(snapshot = null) {
  if (snapshot) return syncActiveDownloadsUI(snapshot);
  if (activeDownloadUISync) return activeDownloadUISync;
  activeDownloadUISync = syncActiveDownloadsUI().finally(() => { activeDownloadUISync = null; });
  return activeDownloadUISync;
}

const waktuSelesaiTerlihat = new Map();
const BATAS_TUNGGU_SELESAI_MS = 2000;

async function syncActiveDownloadsUI(activeDownloadsPassed = null) {
  const activeDownloads = activeDownloadsPassed || await getActiveDownloadSnapshot();
  if (!activeDownloads) return;

  const mediaItems = [...new Set([...document.querySelectorAll('.media-item'), ...activeDownloadingElements])];
  const activeIds = Object.keys(activeDownloads);
  const activeIdSet = new Set(activeIds);
  const itemsById = new Map();
  const itemsByUrl = new Map();
  const itemsByUrlTanpaQuery = new Map();
  for (const item of mediaItems) {
    if (item.dataset.downloadId) itemsById.set(item.dataset.downloadId, item);
    const url = item.dataset.url;
    if (url) {
      if (!itemsByUrl.has(url)) itemsByUrl.set(url, item);
      const tanpaQuery = url.split('?')[0];
      if (!itemsByUrlTanpaQuery.has(tanpaQuery)) itemsByUrlTanpaQuery.set(tanpaQuery, []);
      itemsByUrlTanpaQuery.get(tanpaQuery).push(item);
    }
  }

  let hasZip = false;
  let lastNonZipEntry = null;

  activeIds.forEach(id => {
    const downloadData = activeDownloads[id];
    const url = downloadData.url;
    const statusSelesai = String(downloadData.status || '').trim().toLowerCase();
    if ((statusSelesai === 'complete' || statusSelesai === 'completed') && !downloadData.isZip) {
      const pertamaKali = waktuSelesaiTerlihat.get(id);
      if (pertamaKali === undefined) {
        waktuSelesaiTerlihat.set(id, Date.now());
      } else if (Date.now() - pertamaKali >= BATAS_TUNGGU_SELESAI_MS) {
        waktuSelesaiTerlihat.delete(id);
        finishDownloadUI(id, true);
        hideGlobalProgressIfMatch(id, url);
        if (url) {
          if (renderedMediaUrls.has(url) || renderedMediaUrls.has(getMediaRenderKey(url, downloadData.mediaType || 'file'))) {
            busakKunciRenderSakaUrl(url, downloadData.mediaType || 'file');
            kurangiRenderedCount(1);
          }
          allMediaRequests = allMediaRequests.filter(item => item.bestRequest.originalUrl !== url);
          allFilteredRequests = allFilteredRequests.filter(item => item.bestRequest.originalUrl !== url);
        }
      }
      return;
    }
    waktuSelesaiTerlihat.delete(id);
    if (url && apakahUrlSudahDiunduh(url, downloadData.mediaType || 'file')) return;

    if (downloadData.isZip) {
      hasZip = true;
      const container = document.getElementById('global-progress-container');
      const bar = document.getElementById('global-progress-bar');
      const text = document.getElementById('global-progress-text');
      const cancel = document.getElementById('cancel-global-operation');
      const pause = document.getElementById('pause-global-operation');
      if (container) {
        if (!(isGroupingEnabled && isGroupProgressEnabled && activeGroup === null)) {
          container.style.display = 'flex';
        } else {
          container.style.display = 'none';
        }
        container.dataset.activeId = String(id);
        container.dataset.paused = downloadData.isPaused ? '1' : '0';
      }
      if (bar) {
        const hasPercent = downloadData.percent !== undefined && downloadData.percent !== null;
        bar.max = (downloadData.status === 'processingStream' || hasPercent) ? 100 : Math.max(downloadData.total || 1, 1);
        bar.value = hasPercent ? downloadData.percent : (downloadData.loaded ?? 0);
        bar.indeterminate = downloadData.status === 'generating';
      }
      if (text) text.textContent = downloadData.status === 'generating'
        ? (browser.i18n.getMessage('zipGenerating') || 'Generating ZIP archive...')
        : (`${downloadData.currentFile || ''}${downloadData.currentFile ? ' • ' : ''}${downloadData.statusText || downloadData.status || browser.i18n.getMessage('zipPreparing') || 'Preparing ZIP...'}`);
      if (pause) {
        pause.style.display = 'inline-flex';
        setGlobalPauseIcon(pause, !!downloadData.isPaused);
        pause.onclick = () => {
          const paused = container?.dataset.paused === '1';
          browser.runtime.sendMessage({ action: paused ? 'resumeActiveDownload' : 'pauseDownload', id }).catch(() => {});
          if (container) container.dataset.paused = paused ? '0' : '1';
          setGlobalPauseIcon(pause, !paused);
        };
      }
      if (cancel) {
        cancel.style.display = 'inline-flex';
        cancel.onclick = () => {
          browser.runtime.sendMessage({ action: 'cancelDownload', id }).catch(() => {});
          hideGlobalProgressIfMatch(id);
          clearZipProgressFromGroupCards(id);
        };
      }

      if (isGroupingEnabled && isGroupProgressEnabled && activeGroup === null) {
        const pct = downloadData.percent ?? downloadData.loaded ?? 0;
        const isIndet = downloadData.status === 'generating' || (downloadData.percent === undefined && !downloadData.loaded);
        const zTxt = downloadData.status === 'generating'
          ? (browser.i18n.getMessage('zipGenerating') || 'Generating ZIP archive...')
          : (`${downloadData.currentFile || ''}${downloadData.currentFile ? ' • ' : ''}${downloadData.statusText || downloadData.status || browser.i18n.getMessage('zipPreparing') || 'Preparing ZIP...'}`);
        const finalTxt = zTxt;
        const cancelCb = () => {
          browser.runtime.sendMessage({ action: 'cancelDownload', id }).catch(() => {});
          clearZipProgressFromGroupCards(id);
        };
        const pauseCb = () => {
          const nowPaused = !downloadData.isPaused;
          browser.runtime.sendMessage({ action: nowPaused ? 'pauseDownload' : 'resumeActiveDownload', id }).catch(() => {});
          downloadData.isPaused = nowPaused;
          const zipSaiki2 = zipProgressPerJob.get(String(id));
          if (zipSaiki2) {
            zipSaiki2.isPaused = nowPaused;
            syncZipProgressToGroupCards(zipSaiki2.text, zipSaiki2.percent, zipSaiki2.indeterminate, zipSaiki2.cancelCb, nowPaused, pauseCb, zipSaiki2.groupType ?? null, zipSaiki2.jobId ?? null);
          }
        };
        let zipGT2 = downloadData.groupType || zipProgressPerJob.get(String(id))?.groupType || null;
        if (!zipGT2) {
          const gtSet2 = new Set();
          for (const [, entry] of activeGroupDownloads) { if (entry.groupType) gtSet2.add(entry.groupType); }
          if (gtSet2.size === 1) zipGT2 = [...gtSet2][0];
        }
        syncZipProgressToGroupCards(`📦 ZIP • ${finalTxt}`, isIndet ? 0 : pct, isIndet, cancelCb, !!downloadData.isPaused, pauseCb, zipGT2, id);
      }
      return;
    }

    lastNonZipEntry = { id, downloadData };

    let item = itemsById.get(String(id)) || itemsByUrl.get(url) || null;
    if (!item && url) {
      const calon = itemsByUrlTanpaQuery.get(url.split('?')[0]) || [];
      item = calon.find(k => downloadData.mediaType && k.dataset.type === downloadData.mediaType) || calon[0] || null;
    }

    if (item) {
      item.dataset.downloadId = id;
      if (url && !item.dataset.url) item.dataset.url = url;
      if (downloadData.isAudioJob && downloadData.mediaType === 'audio') {
        item.dataset.downloadMode = 'audio';
      } else if (downloadData.isStreamJob) {
        item.dataset.downloadMode = 'stream';
      } else if (downloadData.mediaType) {
        item.dataset.downloadMode = downloadData.mediaType;
      }
      const dlBtn = item.querySelector('#download-button');
      if (dlBtn) updatePausePlayUI(dlBtn, downloadData.isPaused);
      const cancelBtn = item.querySelector('#cancel-button');
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
      const audioBtn = item.querySelector('#audio-only-button');
      if (audioBtn) audioBtn.style.display = 'none';
      if (downloadData.isAudioJob || downloadData.isStreamJob) {
        updateProgressUI(id, downloadData.percent || 0, 100, false, downloadData.isPaused, downloadData.status, downloadData.percent, null, null, downloadData.mediaType, downloadData.filename);
        const progressItem = uiCache.get(id);
        if (progressItem?.statusInfo) {
          let text = downloadData.status || 'Processing...';
          if (/^Downloading/i.test(text) && downloadData.total > 0) text += ` ${(downloadData.loaded / 1048576).toFixed(1)} MB / ${(downloadData.total / 1048576).toFixed(1)} MB`;
          else if (/^Downloading/i.test(text) && downloadData.loaded > 0) text += ` ${(downloadData.loaded / 1048576).toFixed(1)} MB`;
          progressItem.statusInfo.textContent = text;
        }
      } else {
        updateProgressUI(id, downloadData.loaded, downloadData.total, downloadData.isParallel, downloadData.isPaused, downloadData.status, downloadData.percent, downloadData.finishedParts ?? null, downloadData.totalParts ?? null, downloadData.mediaType, downloadData.filename);
      }

      if (!activeDownloadingElements.includes(item)) {
        prioritizeActiveDownload(item);
      }
    } else {
      if (downloadData.isAudioJob || downloadData.isStreamJob) {
        updateProgressUI(id, downloadData.percent || 0, 100, false, downloadData.isPaused, downloadData.status, downloadData.percent, null, null, downloadData.mediaType, downloadData.filename);
      } else {
        updateProgressUI(id, downloadData.loaded, downloadData.total, downloadData.isParallel, downloadData.isPaused, downloadData.status, downloadData.percent, downloadData.finishedParts ?? null, downloadData.totalParts ?? null, downloadData.mediaType, downloadData.filename);
      }
    }
  });

  for (const idTerlihat of [...waktuSelesaiTerlihat.keys()]) {
    if (!activeIdSet.has(idTerlihat)) waktuSelesaiTerlihat.delete(idTerlihat);
  }

  if (!hasZip && lastNonZipEntry) {
    const { id, downloadData } = lastNonZipEntry;
    const pct = downloadData.percent !== undefined && downloadData.percent !== null
      ? downloadData.percent
      : (downloadData.total > 0 ? (downloadData.loaded / downloadData.total) * 100 : null);
    let statusText = downloadData.statusText || downloadData.status || 'Downloading...';
    if (statusText === 'downloading') statusText = browser.i18n.getMessage("downloadingTitle") || 'Downloading...';
    else if (statusText === 'uploading') statusText = browser.i18n.getMessage("uploadingToGDriveShort") || 'Uploading to Cloud...';
    if (/^Downloading/i.test(statusText) && downloadData.total > 0) {
      statusText += ` ${(downloadData.loaded / 1048576).toFixed(1)} MB / ${(downloadData.total / 1048576).toFixed(1)} MB`;
    } else if (/^Downloading/i.test(statusText) && downloadData.loaded > 0) {
      statusText += ` ${(downloadData.loaded / 1048576).toFixed(1)} MB`;
    }
    updateGlobalOperationBar({
      id,
      url: downloadData.url,
      filename: downloadData.filename,
      text: statusText,
      percent: pct,
      indeterminate: !(downloadData.total > 0) && pct === null,
      isPaused: !!downloadData.isPaused
    });
  } else if (activeIds.length === 0) {
    const gC = document.getElementById('global-progress-container');
    if (gC && gC.dataset.activeId && !activeIdSet.has(gC.dataset.activeId)) {
      hideGlobalProgressIfMatch(gC.dataset.activeId);
    }
  }

  mediaItems.forEach(item => {
    const jobId = item.dataset.downloadId || '';
    if (!jobId || activeIdSet.has(jobId)) return;
    const bar = item.querySelector('mdui-linear-progress');
    const nilaiBar = Number(bar?.value ?? uiCache.get(jobId)?.loadingBar?.value ?? 0);
    if (nilaiBar >= 100) {
      finishDownloadUI(jobId, true);
    } else if (jobId.startsWith('audio_') || jobId.startsWith('stream_') || jobId.startsWith('dl_')) {
      finishDownloadUI(jobId, false);
    }
  });

  segarkanHitunganGrup();
}

// Popup documents can miss progress events while closed. Keep the visible UI
// reconciled with the authoritative background job state.
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (downloadingCount <= 0 && !document.querySelector('.media-item[data-download-id]')) return;
  restoreActiveDownloadsUI();
}, 750);
