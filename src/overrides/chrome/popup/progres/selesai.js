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



function finishDownloadUI(id, isSuccess = false) {
  const normalizedId = String(id ?? '');
  const kunciEntriGrup = golekKunciProgresGrup([normalizedId], null);
  const entriGrup = kunciEntriGrup ? activeGroupDownloads.get(kunciEntriGrup) : null;
  const aliasEntriGrup = entriGrup ? aliasProgresGrup(entriGrup, entriGrup.el) : [];
  const aliasHitung = [...new Set([normalizedId, ...aliasEntriGrup])];
  if (entriGrup || apakahUnduhanKeitung(aliasHitung)) kurangiHitunganSelesai(aliasHitung);
  const affectedGroupTypes = busakProgresGrup([normalizedId], null);
  affectedGroupTypes.forEach(syncGroupProgressCard);
  const itemData = uiCache.get(id);
  if (itemData) {
      const { element, progressContainer } = itemData;
      activeDownloadingElements = activeDownloadingElements.filter(el => el !== element);
      const finishedGroupType = element?.dataset?.type || "video";
      busakProgresGrup([String(id), element?.dataset?.downloadId, element?.dataset?.url], element);
      syncGroupProgressCard(finishedGroupType);

      if (isSuccess) {
          element.remove();
          busakKunciRender(element);
          kurangiRenderedCount(1);

          const mediaContainer = document.getElementById('media-list');
          if (mediaContainer && mediaContainer.querySelectorAll('.media-item').length === 0) {
            renderInitialList();
          }
      } else {
          if (element) delete element.dataset.downloadMode;
          if (progressContainer) progressContainer.remove();

          const dlBtn = element.querySelector('#download-button');
          if (dlBtn) {
            dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>${browser.i18n.getMessage("downloadButton") || "Download"}`;
            dlBtn.classList.remove('is-playing', 'is-paused');
            dlBtn.disabled = false;

            const type = element.dataset.type;
            if (type === 'subtitle' || type === 'file') {
              dlBtn.style.borderRadius = '100px';
            } else {
              dlBtn.style.borderRadius = '';
            }
          }

          const cancelBtn = element.querySelector('#cancel-button');
          const audioBtn = element.querySelector('#audio-only-button');
          if (cancelBtn) cancelBtn.style.display = 'none';
          if (audioBtn && (element.dataset.type === 'video' || element.dataset.type === 'stream')) audioBtn.style.display = 'inline-flex';
      }

      uiCache.delete(id);
      kurangiHitunganSelesai([String(id), element?.dataset?.downloadId, element?.dataset?.url, ...aliasEntriGrup]);
      return;
  }

  const mediaItems = document.querySelectorAll('.media-item');
  mediaItems.forEach(item => {
    if (item.dataset.downloadId === id || item.dataset.url === id) {
      activeDownloadingElements = activeDownloadingElements.filter(el => el !== item);
      const finishedGroupType = item.dataset.type || "video";
      busakProgresGrup([String(id), item.dataset.downloadId, item.dataset.url], item);
      syncGroupProgressCard(finishedGroupType);

      if (isSuccess) {
        item.remove();
        busakKunciRender(item);
        kurangiRenderedCount(1);

        const mediaContainer = document.getElementById('media-list');
        if (mediaContainer && mediaContainer.querySelectorAll('.media-item').length === 0) {
          renderInitialList();
        }
      } else {
        delete item.dataset.downloadMode;
        const progressContainer = item.querySelector('.download-progress-container');
        if (progressContainer) progressContainer.remove();

        const dlBtn = item.querySelector('#download-button');
        if (dlBtn) {
          dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>${browser.i18n.getMessage("downloadButton") || "Download"}`;
          dlBtn.classList.remove('is-playing', 'is-paused');
          dlBtn.disabled = false;

          const type = item.dataset.type;
          if (type === 'subtitle' || type === 'file') {
            dlBtn.style.borderRadius = '100px';
          } else {
            dlBtn.style.borderRadius = '';
          }
        }

        const cancelBtn = item.querySelector('#cancel-button');
        const audioBtn = item.querySelector('#audio-only-button');
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (audioBtn && (item.dataset.type === 'video' || item.dataset.type === 'stream')) audioBtn.style.display = 'inline-flex';
      }

      kurangiHitunganSelesai([String(id), item.dataset.downloadId, item.dataset.url, ...aliasEntriGrup]);
    }
  });
}

function updateDownloadingCount(change) {
  downloadingCount = Math.max(0, downloadingCount + change);
  document.title = downloadingCount > 0 ? `(${downloadingCount}) ${browser.i18n.getMessage("extensionName")}` : browser.i18n.getMessage("extensionName");

  const cancelAllBtn = document.getElementById('cancel-all');
  if (cancelAllBtn) {
    const allCheckboxes = document.querySelectorAll('.media-item .media-checkbox');
    const hasSelection = Array.from(allCheckboxes).some(cb => cb.checked);
    cancelAllBtn.style.display = (downloadingCount > 0 && !hasSelection) ? 'inline-flex' : 'none';
  }
}

const unduhanSelesaiDihitung = new Set();
function kurangiHitunganSelesai(alias) {
  const daftar = (Array.isArray(alias) ? alias : [alias]).filter(a => a !== undefined && a !== null && String(a) !== '');
  if (daftar.length === 0) return;
  if (daftar.some(a => unduhanSelesaiDihitung.has(String(a)))) return;
  daftar.forEach(a => unduhanSelesaiDihitung.add(String(a)));
  updateDownloadingCount(-1);
}

function apakahUnduhanKeitung(alias) {
  const daftar = (Array.isArray(alias) ? alias : [alias]).filter(a => a !== undefined && a !== null && String(a) !== '').map(String);
  if (daftar.length === 0 || !activeDownloadSnapshot) return false;
  for (const [kunci, entri] of Object.entries(activeDownloadSnapshot)) {
    if (entri?.isZip || entri?.isCachedSave || entriUnduhanSelesai(entri)) continue;
    if (daftar.includes(kunci) || (entri?.url && daftar.includes(String(entri.url)))) return true;
  }
  return false;
}

async function shouldSkipHttpError(status) {
  if (status !== 403 && status !== 404) return false;
  const setting = await browser.storage.local.get('skip-http-errors');
  return setting['skip-http-errors'] === '1';
}

function handleSkippedHttpError(url, status) {
  allMediaRequests = allMediaRequests.filter(item => item.bestRequest.originalUrl !== url);
  allFilteredRequests = allFilteredRequests.filter(item => item.bestRequest.originalUrl !== url);
  const skipEl = document.querySelector(`.media-item[data-url="${CSS.escape(url)}"]`);
  if (skipEl) {
    skipEl.remove();
    busakKunciRender(skipEl);
    kurangiRenderedCount(1);
  }
  finishDownloadUI(url, false);
  if (typeof mdui !== 'undefined' && mdui.snackbar) {
    tampilnoNotif(`Skipped (HTTP ${status || '4xx'}): ${url.split('/').pop() || url}`);
  }
}
