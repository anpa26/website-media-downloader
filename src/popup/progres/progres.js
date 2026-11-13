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



function setGlobalPauseIcon(btn, paused) {
  const p = btn && btn.querySelector('svg path');
  if (p) p.setAttribute('d', paused ? 'M8 5v14l11-7z' : 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
}

function hideGlobalProgressIfMatch(...ids) {
  const gC = document.getElementById('global-progress-container');
  if (!gC) return;
  const activeId = gC.dataset.activeId;
  const activeUrl = gC.dataset.activeUrl;
  const candidates = ids.filter(Boolean).map(String);
  if (!activeId || candidates.length === 0 || candidates.includes(activeId) || (activeUrl && candidates.includes(activeUrl))) {
    clearTimeout(window.__wmdGlobalHide);
    gC.style.display = 'none';
    delete gC.dataset.activeId;
    delete gC.dataset.activeUrl;
  }
}

function updateGlobalOperationBar({ id, url, filename, text, percent, indeterminate, isPaused = false }) {
  if (isGroupingEnabled && isGroupProgressEnabled && activeGroup === null) {
    const gC = document.getElementById('global-progress-container');
    if (gC) gC.style.display = 'none';
    return;
  }
  return;
}

function entriUnduhanSelesai(downloadData) {
  const statusNormal = String(downloadData.status || 'downloading').trim().toLowerCase();
  if (statusNormal === 'complete' || statusNormal === 'completed') return true;
  const persenAkhir = downloadData.percent !== undefined && downloadData.percent !== null && !isNaN(downloadData.percent)
    ? Math.min(100, Math.max(0, Math.round(Number(downloadData.percent))))
    : (downloadData.total > 0 ? Math.min(100, Math.max(0, Math.round(((downloadData.loaded || 0) / downloadData.total) * 100))) : null);
  return persenAkhir !== null && persenAkhir >= 100 && statusNormal === 'downloading';
}

function updateProgressUI(id, loaded, total, isParallel = false, isPaused = false, status = 'downloading', percent = null, finishedParts = null, totalParts = null, mediaTypeHint = null, filenameHint = null) {
  let item = uiCache.get(id);
  const statusNormal = String(status || 'downloading').trim().toLowerCase();
  const persenAkhir = percent !== undefined && percent !== null && !isNaN(percent)
    ? Math.min(100, Math.max(0, Math.round(Number(percent))))
    : (total > 0 && loaded >= 0 ? Math.min(100, Math.max(0, Math.round((loaded / total) * 100))) : null);
  const sudahSelesai = statusNormal === 'complete' || statusNormal === 'completed' ||
    (persenAkhir !== null && persenAkhir >= 100 && statusNormal === 'downloading');

  if (!item) {
    const mediaItems = [...new Set([...document.querySelectorAll('.media-item'), ...activeDownloadingElements])];
    for (const el of mediaItems) {
      if (el.dataset.downloadId === String(id) || el.dataset.url === id) {
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
        uiCache.set(id, item);
        if (el.dataset.downloadId) uiCache.set(el.dataset.downloadId, item);
        if (el.dataset.url) uiCache.set(el.dataset.url, item);
        break;
      }
    }
  }

  if (item) {
    prioritizeActiveDownload(item.element);
    const { loadingBar, statusInfo, dlBtn, cancelBtn, audioBtn } = item;

    if (dlBtn) {
        updatePausePlayUI(dlBtn, isPaused);
        if (cancelBtn) {
          cancelBtn.style.display = 'inline-flex';
          dlBtn.style.borderRadius = '';
        }
        if (audioBtn) audioBtn.style.display = 'none';
    }

    if (isParallel) {
        statusInfo.style.color = 'rgb(var(--mdui-color-primary))';
        statusInfo.style.fontWeight = 'bold';
    } else {
        statusInfo.style.color = '';
        statusInfo.style.fontWeight = '';
    }

    if (isPaused) {
        statusInfo.style.opacity = '0.7';
    } else {
        statusInfo.style.opacity = '1';
    }

    if (status === 'uploading') {
        const pct = percent || (total > 0 ? Math.round((loaded / total) * 100) : 0);
        loadingBar.value = 100;
        loadingBar.indeterminate = false;
        loadingBar.classList.add('uploading-phase');
        const statusText = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...");
        statusInfo.textContent = (isPaused ? `[${(browser?.i18n?.getMessage?.("pausedStatus") || chrome?.i18n?.getMessage?.("pausedStatus")) || "Paused"}] ` : "") + statusText + ` (${pct}%)`;
        return;
    }

    const now = performance.now();
    if (!item.speedTime || isPaused || loaded < item.speedBytes) {
        item.speedTime = now;
        item.speedBytes = loaded;
        if (isPaused) item.currentSpeedStr = '';
    } else {
        const elapsed = now - item.speedTime;
        if (elapsed >= 1000) {
            const diffBytes = loaded - item.speedBytes;
            if (diffBytes > 0) {
                const bps = (diffBytes / elapsed) * 1000;
                const mbps = (bps / (1024 * 1024)).toFixed(2);
                if (mbps >= 1) {
                    item.currentSpeedStr = ` • ${mbps} MB/s`;
                } else {
                    const kbps = (bps / 1024).toFixed(0);
                    item.currentSpeedStr = ` • ${kbps} KB/s`;
                }
            } else {
                item.currentSpeedStr = ` • 0 KB/s`;
            }
            item.speedTime = now;
            item.speedBytes = loaded;
        }
    }
    const speedText = item.currentSpeedStr || '';

    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
    if (total > 0) {
      const totalMB = (total / (1024 * 1024)).toFixed(2);
      const percent = Math.round((loaded / total) * 100);
      const remainingMB = ((total - loaded) / (1024 * 1024)).toFixed(2);

      let text;
      if (isParallel && finishedParts !== null && totalParts !== null) {
          const partsPercent = Math.round((finishedParts / totalParts) * 100);
          text = (browser.i18n.getMessage("parallelPartProgress", [finishedParts.toString(), totalParts.toString(), partsPercent.toString()]) || `Parts: ${finishedParts}/${totalParts} (${partsPercent}%)`) + ` • ${loadedMB}MB / ${totalMB}MB (${percent}%)${speedText}`;
      } else {
          text = (browser.i18n.getMessage("streamProgressWithSize", [loadedMB, totalMB, percent.toString(), remainingMB]) || `${loadedMB} MB / ${totalMB} MB (${percent}%) • ${remainingMB} MB remaining`) + speedText;
      }

      if (isPaused) text = `[Paused] ${text}`;
      statusInfo.textContent = text;
      loadingBar.indeterminate = false;
      loadingBar.max = 100;
      loadingBar.value = percent;
    } else {
      let text = (browser.i18n.getMessage("streamProgressNoSize", [loadedMB]) || `${loadedMB} MB downloaded`) + speedText;
      if (isPaused) text = `[Paused] ${text}`;
      statusInfo.textContent = text;
      if (loadingBar.indeterminate !== true && !loadingBar.value) {
          loadingBar.indeterminate = true;
      }
    }

    let gType = item.element?.dataset?.downloadMode;
    if (!gType) {
      if (mediaTypeHint) gType = mediaTypeHint;
      else if (item.element?.dataset?.type) gType = item.element.dataset.type;
      else if (id && String(id).startsWith('stream_')) gType = 'stream';
      else if (id && String(id).startsWith('audio_')) gType = 'audio';
      else gType = 'video';
    }
    let fName = item.element?.querySelector(".media-headline")?.textContent?.trim() ||
                item.element?.querySelector(".media-title")?.textContent?.trim() ||
                item.element?.dataset?.filename?.trim();
    if (!fName && id) {
      try {
        const u = new URL(String(id).startsWith("http") ? id : (item.element?.dataset?.url || ""));
        const cleanPath = u.pathname.split("/").filter(Boolean).pop();
        if (cleanPath) fName = decodeURIComponent(cleanPath);
      } catch (e) {}
    }
    if (!fName) fName = filenameHint || item.element?.dataset?.originalUrl || "Media File";
    let curPct = null;
    if (!loadingBar.indeterminate) {
      if (percent !== undefined && percent !== null && !isNaN(percent)) {
        curPct = Math.min(100, Math.max(0, Math.round(Number(percent))));
      } else if (total > 0 && loaded >= 0) {
        curPct = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
      }
    }
    const effectiveId = item.element?.dataset?.downloadId || String(id);
    const dlIdMentah = item.element?.dataset?.downloadId || null;
    const jobIdSakaKartu = dlIdMentah && dlIdMentah !== String(id) && /^(audio|stream|zip|popup)_/.test(dlIdMentah) ? dlIdMentah : null;
    let groupTypeLawas = new Set();
    if (sudahSelesai) {
      groupTypeLawas = busakProgresGrup([String(effectiveId), String(id), item.element?.dataset?.url], item.element);
    } else {
      ({ groupTypeLawas } = simpenProgresGrup({
        id: effectiveId,
        jobId: jobIdSakaKartu,
        downloadId: String(id).startsWith('http') ? null : String(id),
        url: item.element?.dataset?.url || null,
        groupType: gType,
        filename: fName,
        percent: curPct,
        indeterminate: !!loadingBar.indeterminate,
        text: statusInfo.textContent || "",
        isPaused: !!isPaused,
        el: item.element
      }, item.element, true));
    }
    syncGroupProgressCard(gType);
    groupTypeLawas.forEach(syncGroupProgressCard);
  } else {
    const activeReq = (typeof allFilteredRequests !== 'undefined' ? allFilteredRequests : []).find(r =>
      r.bestRequest?.originalUrl === id || r.bestRequest?.url === id || String(r.downloadId) === String(id)
    ) || (typeof allMediaRequests !== 'undefined' ? allMediaRequests : []).find(r =>
      r.bestRequest?.originalUrl === id || r.bestRequest?.url === id || String(r.downloadId) === String(id)
    );

    let gType = mediaTypeHint || activeReq?.type;
    if (!gType && id) {
      if (String(id).startsWith('stream_')) gType = 'stream';
      else if (String(id).startsWith('audio_')) gType = 'audio';
      else gType = getMediaType(String(id).startsWith("http") ? id : "") || "video";
    }
    if (!gType) gType = "video";

    let fName = filenameHint || activeReq?.bestRequest?.filename;
    if (!fName && id) {
      try {
        const u = new URL(String(id).startsWith("http") ? id : (activeReq?.bestRequest?.originalUrl || ""));
        const cleanPath = u.pathname.split("/").filter(Boolean).pop();
        if (cleanPath) fName = decodeURIComponent(cleanPath);
      } catch (e) {}
    }
    if (!fName) fName = "Media File";

    let curPct = null;
    if (percent !== undefined && percent !== null && !isNaN(percent)) {
      curPct = Math.min(100, Math.max(0, Math.round(Number(percent))));
    } else if (total > 0 && loaded >= 0) {
      curPct = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
    }

    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
    let text = `${loadedMB} MB`;
    if (total > 0) {
      const totalMB = (total / (1024 * 1024)).toFixed(2);
      text = `${loadedMB} MB / ${totalMB} MB (${curPct}%)`;
    }
    if (isPaused) text = `[Paused] ${text}`;

    const urlB2 = activeReq?.bestRequest?.originalUrl || activeReq?.bestRequest?.url || (String(id).startsWith('http') ? String(id) : null);
    let groupTypeLawas = new Set();
    if (sudahSelesai) {
      groupTypeLawas = busakProgresGrup([String(id), urlB2], null);
    } else {
      ({ groupTypeLawas } = simpenProgresGrup({
        id: String(id),
        downloadId: String(id).startsWith('http') ? null : String(id),
        url: urlB2,
        groupType: gType,
        filename: fName,
        percent: curPct,
        indeterminate: curPct === null && !(total > 0),
        text: text,
        isPaused: !!isPaused,
        el: null
      }, null, false));
    }
    syncGroupProgressCard(gType);
    groupTypeLawas.forEach(syncGroupProgressCard);
  }
}
