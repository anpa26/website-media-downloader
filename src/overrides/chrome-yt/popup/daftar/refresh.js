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



let mediaListLoad = null;
let mediaListReloadRequested = false;
function tampilnoNotif(pesen, opsi = {}) {
  if (pesen === undefined || pesen === null || pesen === '') return;
  if (!document.body) return;
  let el = document.getElementById('wmd-notif');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wmd-notif';
    el.className = 'wmd-notif';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = '';
  const teks = document.createElement('span');
  teks.className = 'wmd-notif-teks';
  teks.textContent = String(pesen);
  el.appendChild(teks);
  if (opsi.aksi && opsi.aksi.label && typeof opsi.aksi.lakokno === 'function') {
    const tombol = document.createElement('button');
    tombol.type = 'button';
    tombol.className = 'wmd-notif-aksi';
    tombol.textContent = String(opsi.aksi.label);
    tombol.addEventListener('click', () => {
      try { opsi.aksi.lakokno(); } catch (_) {}
      el.classList.remove('tampil');
    });
    el.appendChild(tombol);
  }
  el.classList.add('tampil');
  if (el._wmdNotifTimer) clearTimeout(el._wmdNotifTimer);
  const durasi = opsi.durasi === undefined ? 5000 : opsi.durasi;
  if (durasi > 0) {
    el._wmdNotifTimer = setTimeout(() => {
      el.classList.remove('tampil');
      el._wmdNotifTimer = null;
    }, durasi);
  } else {
    el._wmdNotifTimer = null;
  }
}

async function ambilDataMediaMentah() {
    const loadTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Wektu muat daftar media entek (10 detik)')), 10000));
    const [mediaRequests, settings, targetWebTab] = await Promise.race([Promise.all([
      browser.runtime.sendMessage({ action: "getMediaRequests" }),
      browser.storage.local.get(["manual-scan", "manual-scan-keep-tabs", "top-header-design", "bottom-bar-design", "filename-template", "only-video", "only-audio", "only-stream", "only-image", "only-subtitle", "only-file", "hide-segments", "hide-page-components", "media-sort-order", "limit-media-list", "limit-media-list-custom", "min-file-size", "min-file-size-custom", "image-min-side", "image-min-side-custom", "image-min-file-size", "image-min-file-size-custom", "hide-image-without-size", "optimize-low-end", "group-by-type", "group-download-progress", "disable-deduplication", "download-history"]),
      getTargetMediaTab()
    ]), loadTimeout]);
    const currentActiveTabId = targetWebTab?.id;
    let currentActiveHost = '';
    try { if (targetWebTab?.url) currentActiveHost = new URL(targetWebTab.url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) {}
  return { mediaRequests, settings, targetWebTab, currentActiveTabId, currentActiveHost };
}

function kumpulkanActiveItems() {
  const mediaContainer = document.getElementById('media-list');
  const activeItems = new Map();
  activeDownloadingElements.forEach(item => {
    if (item.dataset.url) activeItems.set(item.dataset.url, item);
    if (item.dataset.originalUrl) activeItems.set(item.dataset.originalUrl, item);
  });
  mediaContainer.querySelectorAll('.media-item').forEach(item => {
    if (item.querySelector('mdui-linear-progress')) {
      if (item.dataset.url) activeItems.set(item.dataset.url, item);
      if (item.dataset.originalUrl) activeItems.set(item.dataset.originalUrl, item);
    }
  });

  return activeItems;
}

async function hitungDaftarMediaBaru(mediaRequests, settings, currentActiveTabId, currentActiveHost, activeItems, activeDownloads) {
    const minFileSizeSetting = settings['min-file-size'] || '0';
    const imageMinSideSelection = String(settings['image-min-side'] ?? '0');
    const imageMinSide = imageMinSideSelection === 'custom'
      ? Math.min(10000, Math.max(0, parseInt(settings['image-min-side-custom'], 10) || 0))
      : Math.max(0, parseInt(imageMinSideSelection, 10) || 0);
    const imageMinFileSizeSetting = String(settings['image-min-file-size'] ?? '0');
    const imageMinFileSizeBytes = (imageMinFileSizeSetting === 'custom'
      ? parseInt(settings['image-min-file-size-custom'], 10) || 0
      : parseInt(imageMinFileSizeSetting, 10) || 0) * 1024;
    let minSizeBytes = 0;
    if (minFileSizeSetting === 'custom') {
      const customKB = parseInt(settings['min-file-size-custom']) || 0;
      minSizeBytes = customKB * 1024;
    } else {
      minSizeBytes = (parseInt(minFileSizeSetting) || 0) * 1024;
    }
    const mediaGroups = new Map();
    let mediaScanIndex = 0;
    for (const rawUrl in mediaRequests) {
      if (++mediaScanIndex % 20 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
      if (activeItems.has(rawUrl)) continue;

      const requests = mediaRequests[rawUrl];
      if (!Array.isArray(requests) || requests.length === 0) continue;

      const lastResponseHeaders = requests[requests.length - 1].responseHeaders;
      if (checkIsSegment(rawUrl, lastResponseHeaders, settings)) continue;

      let type = getMediaType(rawUrl, lastResponseHeaders);
      const isManualItem = requests.some(r => r.isManual);
      const isManualScanMode = isFlagEnabled(settings['manual-scan'], false);
      const keepOtherTabs = isFlagEnabled(settings['manual-scan-keep-tabs'], false);

      if (!isManualItem) {
        const matchesCurrentActiveScope = requests.some(r => {
          if (!r) return false;

          let matchesHost = false;
          let hasHostCandidate = false;
          if (currentActiveHost) {
            const cands = [r.pageUrl];
            if (Array.isArray(r.requestHeaders)) {
              for (const h of r.requestHeaders) {
                const n = h?.name?.toLowerCase();
                if ((n === 'referer' || n === 'origin') && h.value) cands.push(h.value);
              }
            }
            for (const c of cands) {
              if (!c) continue;
              try {
                const h = new URL(c).hostname.toLowerCase().replace(/^www\./, '');
                if (h) {
                  hasHostCandidate = true;
                  if (h === currentActiveHost || h.endsWith('.' + currentActiveHost) || currentActiveHost.endsWith('.' + h)) {
                    matchesHost = true;
                    break;
                  }
                }
              } catch (e) {}
            }
          }

          const matchesTabId = currentActiveTabId != null && r.tabId === currentActiveTabId;

          if (hasHostCandidate) {
            if (!matchesHost) return false;
            return matchesTabId || !currentActiveTabId;
          }

          if (matchesTabId) return true;
          return currentActiveTabId == null && !currentActiveHost;
        });

        if (isManualScanMode) {
          const hasManualScan = requests.some(r => r && r.manualScanned);
          if (!hasManualScan) continue;
          if (!keepOtherTabs && !matchesCurrentActiveScope) continue;
        } else if (!keepOtherTabs) {
          if (!matchesCurrentActiveScope) continue;
        }
      }
      if (!type && isManualItem) {
          type = 'file';
      }
      if (!type) continue;

      if (type === 'image' && imageMinSide > 0) {
        const imageRequest = requests.find(request =>
          Number.isInteger(Number(request.imageWidth)) && Number(request.imageWidth) > 0 &&
          Number.isInteger(Number(request.imageHeight)) && Number(request.imageHeight) > 0
        );
        if (imageRequest && Math.min(Number(imageRequest.imageWidth), Number(imageRequest.imageHeight)) < imageMinSide) continue;
      }
      if (type === 'image' && imageMinFileSizeBytes > 0) {
        const imageSize = requests.reduce((max, request) => Math.max(max, parseInt(request.size, 10) || 0), 0);
        if (imageSize > 0 && imageSize < imageMinFileSizeBytes) continue;
      }
      if (type === 'image' && isFlagEnabled(settings['hide-image-without-size'], false) && !requests.some(request => parseInt(request.size, 10) > 0)) continue;

      const showVideo = isFlagEnabled(settings['only-video'], true);
      const showAudio = isFlagEnabled(settings['only-audio'], true);
      const showStream = isFlagEnabled(settings['only-stream'], true);
      const showImage = isFlagEnabled(settings['only-image'], true);
      const showSubtitle = isFlagEnabled(settings['only-subtitle'], true);
      const showFile = isFlagEnabled(settings['only-file'], true);

      if (type === 'video' && !showVideo) continue;
      if (type === 'audio' && !showAudio) continue;
      if (type === 'stream' && !showStream) continue;
      if (type === 'image' && !showImage) continue;
      if (type === 'subtitle' && !showSubtitle) continue;
      if (type === 'file' && !showFile) continue;

      if (minSizeBytes > 0 && type !== 'stream') {
        const reqSize = requests.reduce((maks, r) => Math.max(maks, parseInt(r.size) || 0), 0);
        if (reqSize > 0 && reqSize < minSizeBytes) continue;
      }

      const identity = rawUrl;

      if (!mediaGroups.has(identity)) {
        mediaGroups.set(identity, { requests: [], type });
      }
      const group = mediaGroups.get(identity);

      requests.forEach(req => {
        const currentReq = { ...req, originalUrl: rawUrl };
        const currentSize = parseInt(req.size) || 0;

        if (group.requests.length === 0) {
          group.requests.push(currentReq);
        } else {

          const existingSize = parseInt(group.requests[0].size) || 0;
          if (currentSize > existingSize) {
            group.requests[0] = currentReq;
          }
        }
      });
    }

    const groupsWithNames = [];
    mediaGroups.forEach(group => {

        group.requests.sort((a, b) => {
          const sizeA = parseInt(a.size) || 0;
          const sizeB = parseInt(b.size) || 0;
          return sizeB - sizeA;
        });

        const bestRequest = group.requests[0];

        const mediaUrl = bestRequest.originalUrl || bestRequest.url || "";
        const automaticFilename = mediaFilename.resolve(mediaUrl, bestRequest);
        const filenameTemplate = settings['filename-template'];
        const resolvedFilename = filenameTemplate && filenameTemplate !== '0'
            ? mediaFilename.template(filenameTemplate, mediaUrl, automaticFilename, bestRequest.pageTitle)
            : automaticFilename;
        const urlLower = (bestRequest.originalUrl || bestRequest.url || "").toLowerCase();
        const isStreamUrl = urlLower.includes('.m3u8') || urlLower.includes('.mpd');
        let hasQuality = false;
        if (isStreamUrl) {
            const variants = (urlLower.includes('.mpd') ? mpdVariantsCache : m3u8VariantsCache).get(mediaUrl) || [];
            hasQuality = variants.length > 0;
        } else if (bestRequest.ytFormats && bestRequest.ytFormats.length > 1) {
            hasQuality = true;
        }

        groupsWithNames.push({
            group,
            bestRequest,
            resolvedFilename,
            size: parseInt(bestRequest.size) || 0,
            hasQuality
        });
    });

    const isDisableDeduplication = isFlagEnabled(settings['disable-deduplication'], true);
    const filenameGroupsMap = new Map();
    groupsWithNames.forEach((item, index) => {
        let nameKey;
        if (isDisableDeduplication) {
            nameKey = 'no_dedup_' + index + '_' + (item.bestRequest.originalUrl || item.bestRequest.url || '');
        } else {
            const isVideoAudioStream = ['video', 'audio', 'stream'].includes(item.group.type);
            nameKey = item.resolvedFilename.toLowerCase();
            if (isVideoAudioStream) {
                const baseName = item.resolvedFilename.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();
                nameKey = baseName + '_' + item.group.type + '_media_group';
            }
            try { nameKey += '@' + new URL(item.bestRequest.originalUrl || item.bestRequest.url || '').hostname.toLowerCase(); } catch (_) {}
            if (item.size > 0) {
                nameKey += '_' + item.size;
            } else {
                const urlKey = item.bestRequest.originalUrl || item.bestRequest.url || '';
                nameKey += '_' + urlKey;
            }
        }

        if (!filenameGroupsMap.has(nameKey)) {
            filenameGroupsMap.set(nameKey, []);
        }
        filenameGroupsMap.get(nameKey).push(item);
    });

    const flattenedRequests = [];
    filenameGroupsMap.forEach(items => {
        items.sort((a, b) => {
            // 1. Prioritize having quality options
            if (a.hasQuality && !b.hasQuality) return -1;
            if (!a.hasQuality && b.hasQuality) return 1;

            // 2. Prioritize larger size
            if (a.size !== b.size) {
                return b.size - a.size;
            }

            // 3. Prioritize newer timestamp
            const timeA = a.bestRequest.timeStamp || a.bestRequest.timestamp || 0;
            const timeB = b.bestRequest.timeStamp || b.bestRequest.timestamp || 0;
            return timeB - timeA;
        });

        const bestItem = items[0];
        const group = bestItem.group;
        const bestRequest = bestItem.bestRequest;

        flattenedRequests.push({
          resolvedFilename: bestItem.resolvedFilename,
          bestRequest: bestRequest,
          type: group.type,
          isVideo: group.type === 'video',
          isAudio: group.type === 'audio',
          isStream: group.type === 'stream',
          isSubtitle: group.type === 'subtitle',
          isImage: group.type === 'image',
          isFile: group.type === 'file',
          ytFormats: bestRequest.ytFormats || null,
          ytSubtitles: bestRequest.ytSubtitles || null
        });
    });

    const sortOrder = settings['media-sort-order'] || 'newest';
    let sortedByWorker = false;
    if (globalThis.mediaCompute?.run && flattenedRequests.length > 1) {
      try {
        const indices = await globalThis.mediaCompute.run('media-sort', {
          order: sortOrder,
          items: flattenedRequests.map(item => ({ name: item.resolvedFilename.toLowerCase(), size: parseInt(item.bestRequest.size) || 0, time: item.bestRequest.timeStamp || item.bestRequest.timestamp || 0 }))
        });
        const reordered = indices.map(index => flattenedRequests[index]);
        flattenedRequests.splice(0, flattenedRequests.length, ...reordered);
        sortedByWorker = true;
      } catch (error) { console.warn('Worker media sorting failed; using the compatible fallback.', error); }
    }
    if (!sortedByWorker) flattenedRequests.sort((a, b) => {
      if (sortOrder === 'oldest') {
        return (a.bestRequest.timeStamp || a.bestRequest.timestamp || 0) - (b.bestRequest.timeStamp || b.bestRequest.timestamp || 0);
      } else if (sortOrder === 'letter_asc') {
        const nameA = a.resolvedFilename.toLowerCase();
        const nameB = b.resolvedFilename.toLowerCase();
        const isNumA = /^[0-9]/.test(nameA);
        const isNumB = /^[0-9]/.test(nameB);
        if (isNumA && !isNumB) return 1;
        if (!isNumA && isNumB) return -1;
        return nameA.localeCompare(nameB);
      } else if (sortOrder === 'letter_desc') {
        const nameA = a.resolvedFilename.toLowerCase();
        const nameB = b.resolvedFilename.toLowerCase();
        const isNumA = /^[0-9]/.test(nameA);
        const isNumB = /^[0-9]/.test(nameB);
        if (isNumA && !isNumB) return 1;
        if (!isNumA && isNumB) return -1;
        return nameB.localeCompare(nameA);
      } else if (sortOrder === 'number_desc') {
        const nameA = a.resolvedFilename.toLowerCase();
        const nameB = b.resolvedFilename.toLowerCase();
        const isNumA = /^[0-9]/.test(nameA);
        const isNumB = /^[0-9]/.test(nameB);
        if (isNumA && !isNumB) return -1;
        if (!isNumA && isNumB) return 1;
        return nameB.localeCompare(nameA, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortOrder === 'number_asc') {
        const nameA = a.resolvedFilename.toLowerCase();
        const nameB = b.resolvedFilename.toLowerCase();
        const isNumA = /^[0-9]/.test(nameA);
        const isNumB = /^[0-9]/.test(nameB);
        if (isNumA && !isNumB) return -1;
        if (!isNumA && isNumB) return 1;
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortOrder === 'size_desc') {
        const sizeA = parseInt(a.bestRequest.size) || 0;
        const sizeB = parseInt(b.bestRequest.size) || 0;
        return sizeB - sizeA;
      } else if (sortOrder === 'size_asc') {
        const sizeA = parseInt(a.bestRequest.size) || 0;
        const sizeB = parseInt(b.bestRequest.size) || 0;
        return sizeA - sizeB;
      } else { // newest
        return (b.bestRequest.timeStamp || b.bestRequest.timestamp || 0) - (a.bestRequest.timeStamp || a.bestRequest.timestamp || 0);
      }
    });
    let limitStr = settings['limit-media-list'];
    let limit = 0;
    if (limitStr === 'custom') {
      limit = parseInt(settings['limit-media-list-custom']) || 0;
    } else if (limitStr) {
      limit = parseInt(limitStr);
    }
    if (settings['optimize-low-end'] === '1' || settings['optimize-low-end'] === true) {
      limit = 50;
    }
    muatKunciMediaSudahDiunduh(settings['download-history'] || []);
    const semuaTampil = deduplicateMediaForDisplay(flattenedRequests);
    const itemTersembunyi = semuaTampil.filter(item => apakahMediaSudahDiunduh(item));
    const displayRequests = semuaTampil.filter(item => !apakahMediaSudahDiunduh(item));
    const urlAktif = new Set();
    for (const downloadData of Object.values(activeDownloads || {})) {
      const url = downloadData?.url || '';
      if (!url) continue;
      for (const kunci of kunciMediaDariUrl(url, downloadData.mediaType || 'file')) urlAktif.add(kunci);
    }
    if (limit > 0 && displayRequests.length > limit) {
      displayRequests.length = limit;
    }

    let daftarMedia = displayRequests;


    activeDownloadingElements = [...new Set(activeItems.values())];
    const requestUrls = new Set();
    daftarMedia.forEach(item => {
      const u = item.bestRequest?.originalUrl || item.bestRequest?.url || '';
      if (!u) return;
      requestUrls.add(u);
      requestUrls.add(getMediaRenderKey(u, item.type || 'file'));
    });
    const downloadModels = [];
    let activeCount = 0;
    for (const [id, downloadData] of Object.entries(activeDownloads || {})) {
      if (downloadData.isZip || downloadData.isCachedSave) continue;
      if (entriUnduhanSelesai(downloadData)) continue;
      const url = downloadData.url || '';
      if (url && apakahUrlSudahDiunduh(url, downloadData.mediaType || 'file')) continue;
      activeCount++;
      const type = downloadData.mediaType || 'file';
      const renderKey = getMediaRenderKey(url, type);
      if (requestUrls.has(renderKey) || requestUrls.has(url) || activeItems.has(url)) continue;
      requestUrls.add(renderKey);
      if (url) requestUrls.add(url);
      downloadModels.push({
        downloadId: id,
        bestRequest: { originalUrl: url, size: downloadData.total,
          filename: downloadData.filename, timeStamp: Date.now() },
        type,
        isVideo: type === 'video', isAudio: type === 'audio', isStream: type === 'stream',
        isSubtitle: type === 'subtitle', isImage: type === 'image', isFile: type === 'file'
      });
    }
    // Only the current category/page creates cards, including background downloads.
    return { items: [...downloadModels, ...daftarMedia], activeCount };
}
