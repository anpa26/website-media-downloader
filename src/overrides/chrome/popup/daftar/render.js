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



function renderInitialList() {
  const mediaContainer = document.getElementById('media-list');
  ensureMediaPreviewCleanupObserver(mediaContainer);
  const mediaControls = document.getElementById('media-controls');
  mediaControls?.querySelector('#back-to-groups-btn')?.remove();
  const query = document.getElementById('search-bar').value.trim();

  const activeItems = [...activeDownloadingElements];

  mediaContainer.innerHTML = '';
  for (const [key, cached] of uiCache) {
    if (!activeItems.includes(cached.element)) uiCache.delete(key);
  }
  renderedMediaUrls.clear();
  activeItems.forEach(item => {
    const url = item.dataset.url;
    const origUrl = item.dataset.originalUrl;
    const type = item.dataset.type || 'file';
    if (url) {
      renderedMediaUrls.add(url);
      renderedMediaUrls.add(getMediaRenderKey(url, type));
      renderedMediaUrls.add(`video:${url}`);
      renderedMediaUrls.add(`stream:${url}`);
      renderedMediaUrls.add(`audio:${url}`);
      renderedMediaUrls.add(`file:${url}`);
    }
    if (origUrl && origUrl !== url) {
      renderedMediaUrls.add(origUrl);
      renderedMediaUrls.add(getMediaRenderKey(origUrl, type));
      renderedMediaUrls.add(`video:${origUrl}`);
      renderedMediaUrls.add(`stream:${origUrl}`);
      renderedMediaUrls.add(`audio:${origUrl}`);
      renderedMediaUrls.add(`file:${origUrl}`);
    }
  });
  renderedCount = 0;
  indeksChunkSabanjure = 0;
  if (intersectionObserver) intersectionObserver.disconnect();

  const selectedInfoBar = document.getElementById('selected-info-bar');
  const isSearching = !!query;
  if (isGroupingEnabled && activeGroup === null && !isSearching) {
    if (selectedInfoBar) selectedInfoBar.style.display = 'none';
  } else {
    if (selectedInfoBar) selectedInfoBar.style.display = 'flex';
  }

  if (isGroupingEnabled && activeGroup === null && !isSearching) {
    const counts = getGroupCounts(activeItems);
    const hasItems = activeItems.length > 0 || Object.values(counts).some(c => c > 0);

    if (!hasItems) {
      mediaContainer.innerHTML = getNoMediaDetectedHTML();
      if (selectedInfoBar) selectedInfoBar.style.display = 'none';
      if (mediaControls) mediaControls.style.display = 'flex';
      return;
    }

    if (mediaControls) mediaControls.style.display = 'flex';

    const titles = {
      video: browser.i18n.getMessage("groupByVideoTitle") || "Videos",
      audio: browser.i18n.getMessage("groupByAudioTitle") || "Audio",
      stream: browser.i18n.getMessage("groupByStreamTitle") || "Streams",
      image: browser.i18n.getMessage("groupByImageTitle") || "Images",
      subtitle: browser.i18n.getMessage("groupBySubtitleTitle") || "Subtitles",
      file: browser.i18n.getMessage("groupByFileTitle") || "Files"
    };

    const icons = {
      video: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>`,
      audio: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`,
      stream: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-4h11v4zm0-5H4V9h11v4zm5 5h-4V9h4v9z"/></svg>`,
      image: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/></svg>`,
      subtitle: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-4H6V8h12v4z"/></svg>`,
      file: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`
    };

    const typesOrder = ['video', 'audio', 'stream', 'image', 'subtitle', 'file'];
    typesOrder.forEach(type => {
      const count = counts[type];
      if (count > 0) {
        const groupCard = document.createElement('div');
        groupCard.innerHTML = createGroupItemHTML(type, count, titles[type], icons[type]);
        const cardEl = groupCard.firstElementChild;
        cardEl.addEventListener('click', () => {
          activeGroup = type;
          renderInitialList();
          updateGlobalProgressVisibility();
        });
        mediaContainer.appendChild(cardEl);
        syncGroupProgressCard(type);
      }
    });

    for (const z of zipProgressPerJob.values()) {
      syncZipProgressToGroupCards(z.text, z.percent, z.indeterminate, z.cancelCb, z.isPaused, z.pauseCb, z.groupType ?? null, z.jobId ?? null);
    }

    updateGlobalProgressVisibility();
    return;
  }

  if (isGroupingEnabled && activeGroup !== null) {
    const titles = {
      video: browser.i18n.getMessage("groupByVideoTitle") || "Videos",
      audio: browser.i18n.getMessage("groupByAudioTitle") || "Audio",
      stream: browser.i18n.getMessage("groupByStreamTitle") || "Streams",
      image: browser.i18n.getMessage("groupByImageTitle") || "Images",
      subtitle: browser.i18n.getMessage("groupBySubtitleTitle") || "Subtitles",
      file: browser.i18n.getMessage("groupByFileTitle") || "Files"
    };

    const backHeader = document.createElement('div');
    backHeader.innerHTML = createBackToGroupsHeaderHTML(titles[activeGroup]);
    const backEl = backHeader.firstElementChild;
    backEl.addEventListener('click', () => {
      activeGroup = null;
      renderInitialList();
    });
    mediaControls?.appendChild(backEl);

    activeItems.forEach(item => {
      if (item.dataset.type === activeGroup) {
        mediaContainer.appendChild(item);
      }
    });
  } else if (isSearching && isGroupingEnabled) {
    activeItems.forEach(item => { if (apakahKartuAktifCocokQuery(item, query)) mediaContainer.appendChild(item); });
  } else {
    activeItems.forEach(item => { if (!isSearching || apakahKartuAktifCocokQuery(item, query)) mediaContainer.appendChild(item); });
  }

  const requestsToRender = getActiveRequests();

  const activeItemsVisible = activeItems.filter(item => {
    if (isSearching && isGroupingEnabled && activeGroup === null) return true;
    return !isGroupingEnabled || item.dataset.type === activeGroup;
  });

  if (requestsToRender.length === 0 && activeItemsVisible.length === 0) {
    if (isGroupingEnabled && activeGroup !== null) {
      const emptyMsg = document.createElement('div');
      if (query) {
        emptyMsg.innerHTML = `<div id="no-matches-msg" style="padding: 60px 20px; text-align: center; opacity: 0.8;">No matches found for "${escapeHtmlPopup(query)}"</div>`;
      } else {
        emptyMsg.innerHTML = getNoMediaDetectedHTML();
      }
      mediaContainer.appendChild(emptyMsg);
    } else {
      if (query) {
        mediaContainer.innerHTML = `<div id="no-matches-msg" style="padding: 60px 20px; text-align: center; opacity: 0.8;">No matches found for "${escapeHtmlPopup(query)}"</div>`;
      } else {
        mediaContainer.innerHTML = getNoMediaDetectedHTML();
      }
    }
    if (selectedInfoBar) selectedInfoBar.style.display = 'none';
    if (mediaControls) mediaControls.style.display = 'flex';
    updateSelectedCount();
    return;
  }

  if (mediaControls) mediaControls.style.display = 'flex';
  renderNextChunk();
}

function nungguManifestHls(hlsInstance, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let rampung = false;
    const rampungno = (sukses) => {
      if (rampung) return;
      rampung = true;
      clearTimeout(timer);
      try { hlsInstance.off(Hls.Events.MANIFEST_PARSED, onParsed); } catch (_) {}
      try { hlsInstance.off(Hls.Events.ERROR, onError); } catch (_) {}
      if (!sukses) { try { hlsInstance.destroy(); } catch (_) {} }
      resolve(sukses);
    };
    const onParsed = () => rampungno(true);
    const onError = () => rampungno(false);
    const timer = setTimeout(() => rampungno(false), timeoutMs);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, onParsed);
    hlsInstance.on(Hls.Events.ERROR, onError);
  });
}

function kurangiRenderedCount(jumlah) {
  const mundur = Math.max(0, jumlah || 0);
  renderedCount = Math.max(0, renderedCount - mundur);
  indeksChunkSabanjure = Math.max(0, indeksChunkSabanjure - mundur);
  if (isGroupingEnabled && activeGroup === null) return;
  renderNextChunk();
}

function renderNextChunk() {
  if (isRenderingChunk) return;
  isRenderingChunk = true;
  try {
  const mediaContainer = document.getElementById('media-list');
  const fragment = document.createDocumentFragment();
  const requestsToRender = getActiveRequests();
  const nextChunk = requestsToRender.slice(indeksChunkSabanjure, indeksChunkSabanjure + CHUNK_SIZE);
  let jumlahKartuDibuat = 0;

  nextChunk.forEach(item => {
    const itemUrl = item.bestRequest.originalUrl;
    const itemUrlBase = getMediaRenderKey(itemUrl, item.type || 'file');
    if (renderedMediaUrls.has(itemUrlBase) || renderedMediaUrls.has(itemUrl)) return;
    renderedMediaUrls.add(itemUrl);
    renderedMediaUrls.add(itemUrlBase);

    let mediaDiv;
    try {
      mediaDiv = createMediaItem(item);
    } catch (e) {
      console.error('[website-media-downloader] Skip item media rusak:', item?.bestRequest?.originalUrl, e);
      return;
    }
    if (item.downloadId !== undefined) mediaDiv.dataset.downloadId = item.downloadId;
    fragment.appendChild(mediaDiv);
    jumlahKartuDibuat++;
  });

  const oldSentinel = document.getElementById('infinite-scroll-sentinel');
  if (oldSentinel) oldSentinel.remove();

  const oldEndMsg = document.getElementById('end-of-media-list');
  if (oldEndMsg) oldEndMsg.remove();

  mediaContainer.appendChild(fragment);
  indeksChunkSabanjure += nextChunk.length;
  renderedCount += jumlahKartuDibuat;

  if (indeksChunkSabanjure < requestsToRender.length) {
    const sentinel = document.createElement('div');
    sentinel.id = 'infinite-scroll-sentinel';
    sentinel.style.height = '20px';
    mediaContainer.appendChild(sentinel);

    if (!intersectionObserver) {
      intersectionObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          renderNextChunk();
        }
      }, { rootMargin: '200px' });
    }
    intersectionObserver.observe(sentinel);
  } else if (requestsToRender.length > 0) {
   const endMsg = document.createElement('div');
   endMsg.id = "end-of-media-list";
   endMsg.className = "end-of-list-container";

   const fullText = browser.i18n.getMessage("endOfMediaList");
   const firstDotIndex = fullText.indexOf('!');
   const titleText = firstDotIndex !== -1 ? fullText.substring(0, firstDotIndex + 1) : fullText;
   const bodyText = firstDotIndex !== -1 ? fullText.substring(firstDotIndex + 1).trim() : '';

   endMsg.innerHTML = `
     <div class="end-of-list-title">${titleText}</div>
     <div class="end-of-list-text">${bodyText}</div>
     ${getEmptyListActionButtonsHTML()}
   `;
   mediaContainer.appendChild(endMsg);
  }

  restoreActiveDownloadsUI();
  updateSelectedCount();
  } finally {
    isRenderingChunk = false;
  }
}
