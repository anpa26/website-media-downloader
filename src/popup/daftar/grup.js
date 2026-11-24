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



function createGroupItemHTML(type, count, title, iconSVG) {
  return `
    <div class="media-group-card" data-group-type="${type}" style="
      margin: 12px 16px;
      border-radius: var(--app-border-radius);
      background-color: var(--surface-low);
      border: 1px solid rgb(var(--mdui-color-outline-variant));
      transition: var(--transition);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      padding: 16px 20px;
      gap: 0;
      box-sizing: border-box;
    ">
      <div style="display: flex; align-items: center; gap: 16px; width: 100%;">
      <div style="
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background-color: rgba(var(--mdui-color-primary), 0.1);
        color: var(--primary);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        ${iconSVG}
      </div>
      <div style="flex-grow: 1;">
        <h4 style="margin: 0; font-size: 0.95rem; font-weight: 600; color: rgb(var(--mdui-color-on-surface));">${title}</h4>
        <span style="font-size: 0.8rem; color: var(--on-surface-variant); opacity: 0.8;">${count} ${count === 1 ? 'item' : 'items'}</span>
      </div>
      <mdui-icon style="opacity: 0.5; color: rgb(var(--mdui-color-on-surface));">
        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
      </mdui-icon>
      </div>
    </div>
  `;
}

function createBackToGroupsHeaderHTML(title) {
  return `
    <div id="back-to-groups-btn" class="media-group-header" style="
      margin: 12px 16px 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 100px;
      width: fit-content;
      background-color: rgba(var(--mdui-color-primary), 0.08);
      color: var(--primary);
      font-size: 0.85rem;
      font-weight: 600;
      transition: var(--transition);
    ">
      <svg viewBox="0 0 24 24" width="18" height="18" style="transform: scaleX(-1);"><path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      <span>Back to Groups (${title})</span>
    </div>
  `;
}

function judhulGrup(tipe) {
  const judhul = {
    video: browser.i18n.getMessage("groupByVideoTitle") || "Videos",
    audio: browser.i18n.getMessage("groupByAudioTitle") || "Audio",
    stream: browser.i18n.getMessage("groupByStreamTitle") || "Streams",
    image: browser.i18n.getMessage("groupByImageTitle") || "Images",
    subtitle: browser.i18n.getMessage("groupBySubtitleTitle") || "Subtitles",
    file: browser.i18n.getMessage("groupByFileTitle") || "Files"
  };
  return judhul[tipe] || judhul.file;
}

function ikonGrup(tipe) {
  const ikon = {
    video: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>`,
    audio: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`,
    stream: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-4h11v4zm0-5H4V9h11v4zm5 5h-4V9h4v9z"/></svg>`,
    image: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/></svg>`,
    subtitle: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-4H6V8h12v4z"/></svg>`,
    file: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`
  };
  return ikon[tipe] || ikon.file;
}

function tambahKartuGrup(tipe, jumlah) {
  const mediaContainer = document.getElementById('media-list');
  if (!mediaContainer) return;
  mediaContainer.querySelector('.no-media-container')?.remove();
  if (mediaContainer.querySelector(`.media-group-card[data-group-type="${tipe}"]`)) return;
  const wadah = document.createElement('div');
  wadah.innerHTML = createGroupItemHTML(tipe, jumlah, judhulGrup(tipe), ikonGrup(tipe));
  const kartu = wadah.firstElementChild;
  if (!kartu) return;
  kartu.addEventListener('click', () => {
    activeGroup = tipe;
    renderInitialList();
    updateGlobalProgressVisibility();
  });
  const urutan = ['video', 'audio', 'stream', 'image', 'subtitle', 'file'];
  const indeksAnyar = urutan.indexOf(tipe);
  let disisipno = null;
  for (const liyane of mediaContainer.querySelectorAll('.media-group-card[data-group-type]')) {
    if (urutan.indexOf(liyane.dataset.groupType) > indeksAnyar) { disisipno = liyane; break; }
  }
  if (disisipno) mediaContainer.insertBefore(kartu, disisipno);
  else mediaContainer.appendChild(kartu);
  syncGroupProgressCard(tipe);
}

function busakKartuGrup(tipe) {
  document.querySelector(`.media-group-card[data-group-type="${tipe}"]`)?.remove();
}

function ensureMediaPreviewCleanupObserver(container) {
  if (container._previewCleanupObserver) return;
  const cleanupNode = (node) => {
    if (!(node instanceof Element) || node.isConnected) return;
    if (typeof node.cleanupMediaPreview === 'function') node.cleanupMediaPreview();
    node.querySelectorAll('.media-item').forEach(item => {
      if (typeof item.cleanupMediaPreview === 'function') item.cleanupMediaPreview();
    });
  };
  container._previewCleanupObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.removedNodes.forEach(cleanupNode));
  });
  container._previewCleanupObserver.observe(container, { childList: true, subtree: true });
}

function apakahKartuAktifCocokQuery(item, query) {
  if (!query) return true;
  const q = String(query).trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.dataset.url || '', item.dataset.originalUrl || '', item.dataset.type || '', item.textContent || ''].join(' ').toLowerCase();
  return haystack.includes(q);
}

let tekenHitunganGrupBertahap = null;
let wektuSegarKartuPungkasan = 0;
function resetHitunganGrupBertahap() {
  tekenHitunganGrupBertahap = null;
  wektuSegarKartuPungkasan = 0;
}
function apakahKartuGrupBertahapKaton() {
  if (!isGroupingEnabled || activeGroup !== null) return false;
  const wadah = document.getElementById('media-list');
  if (!wadah) return false;
  if (wadah.querySelector('.media-item')) return false;
  return !!wadah.querySelector('.media-group-card[data-group-type]');
}
function segarkanKartuGrupBertahap(hitungan) {
  if (!isGroupingEnabled || activeGroup !== null) return;
  const bilahGolek = document.getElementById('search-bar');
  if (bilahGolek && bilahGolek.value.trim()) return;
  const wadah = document.getElementById('media-list');
  if (!wadah) return;
  if (wadah.querySelector('.media-item')) return;
  const urutan = ['video', 'audio', 'stream', 'image', 'subtitle', 'file'];
  const teken = urutan.map(tipe => tipe + ':' + (hitungan[tipe] || 0)).join(',');
  if (teken === tekenHitunganGrupBertahap) return;
  const saiki = performance.now();
  if (tekenHitunganGrupBertahap !== null && saiki - wektuSegarKartuPungkasan < 150) return;
  tekenHitunganGrupBertahap = teken;
  wektuSegarKartuPungkasan = saiki;
  let onoKartu = false;
  for (const tipe of urutan) {
    const jumlah = hitungan[tipe] || 0;
    const kartu = wadah.querySelector('.media-group-card[data-group-type="' + tipe + '"]');
    if (jumlah > 0) {
      onoKartu = true;
      if (kartu) {
        const label = kartu.querySelector('h4 + span');
        const teks = jumlah + ' ' + (jumlah === 1 ? 'item' : 'items');
        if (label && label.textContent !== teks) label.textContent = teks;
      } else {
        tambahKartuGrup(tipe, jumlah);
      }
    } else if (kartu) {
      kartu.remove();
    }
  }
  if (!onoKartu) return;
  wadah.querySelector(':scope > .tab-skeleton')?.remove();
  wadah.classList.remove('tab-content-loading');
  const barInfo = document.getElementById('selected-info-bar');
  if (barInfo) barInfo.style.display = 'none';
  const barMedia = document.getElementById('media-controls');
  if (barMedia) barMedia.style.display = 'flex';
  for (const z of zipProgressPerJob.values()) {
    syncZipProgressToGroupCards(z.text, z.percent, z.indeterminate, z.cancelCb, z.isPaused, z.pauseCb, z.groupType ?? null, z.jobId ?? null);
  }
  updateGlobalProgressVisibility();
}
