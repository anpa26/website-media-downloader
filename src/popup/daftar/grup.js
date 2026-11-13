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
