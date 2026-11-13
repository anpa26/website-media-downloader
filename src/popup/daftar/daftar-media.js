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


function applyManualScanUI(enabled, barDesign = 'v3') {
  manualScanEnabled = !!enabled;
  const dial = document.getElementById('bottom-speed-dial');
  if (!dial) return;
  const isV2 = barDesign === 'v2';
  dial.classList.toggle('classic', isV2 && !manualScanEnabled);
  if (!manualScanEnabled || !isV2) {
    dial.classList.remove('open');
    document.getElementById('speed-dial-toggle')?.setAttribute('aria-expanded', 'false');
  }

  const refreshBtn = document.getElementById('refresh-list');
  const refreshIcon = refreshBtn?.querySelector('mdui-icon');
  const refreshLabel = browser.i18n.getMessage('refreshListButton') || 'Refresh list';
  if (refreshBtn) {
    const isFilledRefresh = !isV2 || !manualScanEnabled;
    refreshBtn.setAttribute('variant', isFilledRefresh ? 'filled' : 'tonal');
    if (barDesign === 'v3') {
      if (refreshIcon) refreshIcon.setAttribute('slot', 'icon');
      refreshBtn.setAttribute('title', refreshLabel);
      refreshBtn.setAttribute('aria-label', refreshLabel);
    } else if (isV2 && manualScanEnabled) {
      if (refreshIcon) refreshIcon.setAttribute('slot', 'icon');
      refreshBtn.removeAttribute('title');
      refreshBtn.removeAttribute('aria-label');
    } else {
      if (refreshIcon) refreshIcon.removeAttribute('slot');
      refreshBtn.setAttribute('title', refreshLabel);
      refreshBtn.setAttribute('aria-label', refreshLabel);
    }
  }

  const addBtn = document.getElementById('add-manual-url-btn-bottom');
  const addIcon = addBtn?.querySelector('mdui-icon');
  const addSpan = addBtn?.querySelector('span');
  if (addBtn && addIcon) {
    const shortLabel = browser.i18n.getMessage('addShortButton') || 'Add';
    const fullLabel = browser.i18n.getMessage('addManualUrlButton') || 'Add URL';
    const label = (barDesign === 'v3' || isV2) ? shortLabel : fullLabel;
    if (addSpan) addSpan.textContent = label;
    if (barDesign === 'v3') {
      addIcon.setAttribute('slot', 'icon');
      addBtn.removeAttribute('title');
      addBtn.removeAttribute('aria-label');
    } else if (isV2 && manualScanEnabled) {
      addIcon.setAttribute('slot', 'icon');
      addBtn.removeAttribute('title');
      addBtn.removeAttribute('aria-label');
    } else {
      addIcon.removeAttribute('slot');
      addBtn.setAttribute('title', label);
      addBtn.setAttribute('aria-label', label);
    }
  }

  const clearBtn = document.getElementById('clear-list');
  const clearIcon = clearBtn?.querySelector('mdui-icon');
  const clearLabel = browser.i18n.getMessage('clearListButton') || 'Clear list';
  if (clearBtn) {
    if (barDesign === 'v3') {
      if (clearIcon) clearIcon.setAttribute('slot', 'icon');
      clearBtn.setAttribute('title', clearLabel);
      clearBtn.setAttribute('aria-label', clearLabel);
    } else if (isV2 && manualScanEnabled) {
      if (clearIcon) clearIcon.setAttribute('slot', 'icon');
      clearBtn.removeAttribute('title');
      clearBtn.removeAttribute('aria-label');
    } else {
      if (clearIcon) clearIcon.removeAttribute('slot');
      clearBtn.setAttribute('title', clearLabel);
      clearBtn.setAttribute('aria-label', clearLabel);
    }
  }

  const scanBtn = document.getElementById('manual-scan-btn-bottom');
  const scanIcon = scanBtn?.querySelector('mdui-icon');
  if (scanBtn) {
    if (scanIcon) scanIcon.setAttribute('slot', 'icon');
    scanBtn.style.display = (barDesign === 'v1' || !manualScanEnabled) ? 'none' : '';
  }
}

function getEmptyListActionButtonsHTML() {
  const scanLabel = browser.i18n.getMessage("scanNowButton") || "Scan";
  const addShortLabel = browser.i18n.getMessage("addShortButton") || "Add";
  return `
      <div style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px;">
        ${manualScanEnabled ? `<mdui-button variant="tonal" id="manual-scan-btn-empty" style="--mdui-shape-corner-extra-small: 16px;"><mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></mdui-icon><span data-translate="scanNowButton">${scanLabel}</span></mdui-button>` : ''}
        <mdui-button variant="tonal" id="add-manual-url-btn-empty" style="--mdui-shape-corner-extra-small: 16px;"><mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></mdui-icon><span data-translate="addShortButton">${addShortLabel}</span></mdui-button>
      </div>
  `;
}

function getNoMediaDetectedHTML() {
  return `
    <div class="end-of-list-container no-media-container">
      <div class="end-of-list-title">${browser.i18n.getMessage("errorTitle4") || 'Info'}</div>
      <div class="end-of-list-text">${browser.i18n.getMessage("noMediaDetected")}</div>
      ${getEmptyListActionButtonsHTML()}
    </div>
  `;
}

function updateSelectedCount() {
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  const activeReqs = getActiveRequests();
  const selectedInActive = activeReqs.filter(req => selectedUrls.has(req.bestRequest.originalUrl));
  const selectedCount = selectedInActive.length;

  const downloadSelectedBtn = document.getElementById('download-selected');
  const deleteSelectedBtn = document.getElementById('delete-selected');
  const cancelSelectedBtn = document.getElementById('cancel-selected');

  if (selectAllCheckbox) {
    selectAllCheckbox.checked = activeReqs.length > 0 && selectedCount === activeReqs.length;
  }

  const allCheckboxes = document.querySelectorAll('.media-item .media-checkbox');
  const renderedSelected = Array.from(allCheckboxes).filter(cb => cb.checked);
  let hasActiveSelected = renderedSelected.some(cb =>
    cb.closest('.media-item')?.querySelector('mdui-linear-progress')
  );

  document.getElementById('selected-count').textContent = browser.i18n.getMessage("selectedCount", [selectedCount.toString()]);

  const downloadAllBtn = document.getElementById('download-all');
  const cancelAllBtn = document.getElementById('cancel-all');

  if (selectedCount > 0) {
    downloadSelectedBtn.style.display = 'inline-flex';
    deleteSelectedBtn.style.display = 'inline-flex';
    cancelSelectedBtn.style.display = hasActiveSelected ? 'inline-flex' : 'none';
    if (downloadAllBtn) downloadAllBtn.style.display = 'none';
    if (cancelAllBtn) cancelAllBtn.style.display = 'none';
  } else {
    downloadSelectedBtn.style.display = 'none';
    deleteSelectedBtn.style.display = 'none';
    cancelSelectedBtn.style.display = 'none';
    if (downloadAllBtn) downloadAllBtn.style.display = 'inline-flex';
    if (cancelAllBtn) {
      cancelAllBtn.style.display = downloadingCount > 0 ? 'inline-flex' : 'none';
    }
  }
}

function filterAndRenderMediaList(query = '') {
  const lowerQuery = query.trim().toLowerCase();

  if (!lowerQuery) {
    allFilteredRequests = [...allMediaRequests];
  } else {
    allFilteredRequests = allMediaRequests.filter(item => apakahItemCocokPanelusuran(item, lowerQuery));
  }

  renderInitialList();
}

function getMediaRenderKey(url, type = '') {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'googlevideo.com' || parsed.hostname.endsWith('.googlevideo.com')) {
      const streamId = parsed.searchParams.get('id') || '';
      if (streamId) return `googlevideo:${type}:${streamId}`;
      return `googlevideo:${type}:${url}`;
    }
  } catch (_) {}
  return `${type}:${url}`;
}

function kunciMediaDariUrl(url, type = 'file') {
  return [url, getMediaRenderKey(url, type)];
}

function muatKunciMediaSudahDiunduh(riwayat) {
  for (const item of riwayat || []) {
    const url = item?.url || '';
    if (!url) continue;
    for (const kunci of kunciMediaDariUrl(url, item.mediaType || 'file')) kunciMediaSudahDiunduh.add(kunci);
  }
}

function apakahUrlSudahDiunduh(url, type = 'file') {
  if (!url || kunciMediaSudahDiunduh.size === 0) return false;
  return kunciMediaDariUrl(url, type).some(kunci => kunciMediaSudahDiunduh.has(kunci));
}

function apakahMediaSudahDiunduh(item) {
  const url = item?.bestRequest?.originalUrl || item?.bestRequest?.url || '';
  return apakahUrlSudahDiunduh(url, item?.type || 'file');
}


function getMediaRepresentativeScore(item) {
  const request = item?.bestRequest || {};
  let score = Array.isArray(request.ytFormats) ? request.ytFormats.length * 1000 : 0;
  const url = request.originalUrl || request.url || '';
  try {
    const tags = new URL(url).searchParams.get('xtags') || '';
    if (tags.includes('acont=original')) score += 100;
  } catch (_) {}
  if (/\boriginal\b|\bdefault\b/i.test(request.pageTitle || '')) score += 10;
  return score;
}

function deduplicateMediaForDisplay(items) {
  const positions = new Map();
  const result = [];
  for (const item of items) {
    const url = item?.bestRequest?.originalUrl || item?.bestRequest?.url || '';
    const key = getMediaRenderKey(url, item?.type || 'file');
    if (!positions.has(key)) {
      positions.set(key, result.length);
      result.push(item);
    } else {
      const index = positions.get(key);
      if (getMediaRepresentativeScore(item) > getMediaRepresentativeScore(result[index])) result[index] = item;
    }
  }
  return result;
}

function getGroupCounts(activeItems) {
  const counts = { video: 0, audio: 0, stream: 0, image: 0, subtitle: 0, file: 0 };
  const countedUrls = new Set();
  const increment = type => {
    const groupType = counts[type] !== undefined ? type : "file";
    counts[groupType]++;
  };

  // Active cards are rendered first and reserve their URL before detected items.
  activeItems.forEach(item => {
    const url = item.dataset.url || "";
    const origUrl = item.dataset.originalUrl || "";
    const type = item.dataset.type || "file";
    if (url) {
      countedUrls.add(getMediaRenderKey(url, type));
      countedUrls.add(url);
    }
    if (origUrl && origUrl !== url) {
      countedUrls.add(getMediaRenderKey(origUrl, type));
      countedUrls.add(origUrl);
    }
    increment(type);
  });

  allFilteredRequests.forEach(item => {
    const url = item.bestRequest.originalUrl || item.bestRequest.url || "";
    const normalizedUrl = getMediaRenderKey(url, item.type || "file");
    if (url && countedUrls.has(url)) return;
    if (normalizedUrl && countedUrls.has(normalizedUrl)) return;
    if (url) countedUrls.add(url);
    if (normalizedUrl) countedUrls.add(normalizedUrl);
    increment(item.type || "file");
  });

  return counts;
}

let segarkanHitunganGrupTimer = null;
function segarkanHitunganGrup() {
  if (segarkanHitunganGrupTimer) return;
  segarkanHitunganGrupTimer = setTimeout(() => { segarkanHitunganGrupTimer = null; segarkanHitunganGrupNyata(); }, 500);
}
function segarkanHitunganGrupNyata() {
  if (!isGroupingEnabled || activeGroup !== null) return;
  const hitungan = getGroupCounts([...activeDownloadingElements]);
  document.querySelectorAll('.media-group-card[data-group-type]').forEach(kartu => {
    const tipe = kartu.dataset.groupType;
    const jumlah = hitungan[tipe] || 0;
    if (jumlah <= 0) {
      kartu.remove();
      return;
    }
    const labelJumlah = kartu.querySelector('h4 + span');
    const teksBaru = `${jumlah} ${jumlah === 1 ? 'item' : 'items'}`;
    if (labelJumlah && labelJumlah.textContent !== teksBaru) labelJumlah.textContent = teksBaru;
  });
}
