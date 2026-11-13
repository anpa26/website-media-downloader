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



function clearMediaList() {
  browser.runtime.sendMessage({ action: 'clearStorage' }).then(() => loadMediaList());
}

const HISTORY_CHUNK_SIZE = 20;
let historyRenderLimit = HISTORY_CHUNK_SIZE;
let historyIntersectionObserver = null;

async function loadHistoryList(reset = true) {
  if (reset) historyRenderLimit = HISTORY_CHUNK_SIZE;
  if (historyIntersectionObserver) {
    historyIntersectionObserver.disconnect();
    historyIntersectionObserver = null;
  }
  const historyContainer = document.getElementById('history-list');
  const historyResult = await browser.storage.local.get('download-history');
  const history = historyResult['download-history'] || [];
  const settings = await browser.storage.local.get(['only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file']);

  if (reset) {
    historyContainer.innerHTML = '';
  } else {
    historyContainer.querySelector('.history-scroll-sentinel')?.remove();
  }

  if (history.length === 0) {
    historyContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noHistory") || "No download history found."}</div>`;
    return;
  }

  let visibleCount = 0;
  history.forEach((item, index) => {

    const type = item.mediaType || getMediaType(item.url, []);

    const showVideo = isFlagEnabled(settings['only-video'], true);
    const showAudio = isFlagEnabled(settings['only-audio'], true);
    const showStream = isFlagEnabled(settings['only-stream'], true);
    const showImage = isFlagEnabled(settings['only-image'], true);
    const showSubtitle = isFlagEnabled(settings['only-subtitle'], true);
    const showFile = isFlagEnabled(settings['only-file'], true);

    if (type === 'video' && !showVideo) return;
    if (type === 'audio' && !showAudio) return;
    if (type === 'stream' && !showStream) return;
    if (type === 'image' && !showImage) return;
    if (type === 'subtitle' && !showSubtitle) return;
    if (type === 'file' && !showFile) return;

    visibleCount++;
    const chunkStart = reset ? 0 : Math.max(0, historyRenderLimit - HISTORY_CHUNK_SIZE);
    if (visibleCount <= chunkStart || visibleCount > historyRenderLimit) return;
    const historyItem = document.createElement('div');
    historyItem.classList.add('media-item', 'history-item');

    const header = document.createElement('div');
    header.classList.add('media-item-header');

    const iconContainer = document.createElement('mdui-icon');
    iconContainer.classList.add('media-preview-icon');
    iconContainer.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>`;
    header.appendChild(iconContainer);

    const info = document.createElement('div');
    info.classList.add('media-item-info');

    const headline = document.createElement('div');
    headline.classList.add('media-headline');
    headline.textContent = item.filename || getFileName(item.url);
    info.appendChild(headline);

    const description = document.createElement('div');
    description.classList.add('media-description');
    const dateStr = new Date(item.timestamp).toLocaleString();
    const siteInfo = item.pageTitle ? `${item.pageTitle} • ` : "";
    description.textContent = `${siteInfo}${dateStr}`;
    info.appendChild(description);
    header.appendChild(info);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '4px';

    const linkBtn = document.createElement('mdui-button-icon');
    linkBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></mdui-icon>`;
    linkBtn.title = browser.i18n.getMessage("copyURL") || "Copy URL";
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(item.url).then(() => {
        if (typeof mdui !== 'undefined' && mdui.snackbar) {
          tampilnoNotif(browser.i18n.getMessage("copyURLSuccess") || "URL copied to clipboard");
        }
      });
    });

    if (item.pageUrl) {
      const visitBtn = document.createElement('mdui-button-icon');
      visitBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg></mdui-icon>`;
      visitBtn.title = browser.i18n.getMessage("historyVisitPage") || "Visit Page";
      visitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof mdui !== 'undefined' && mdui.snackbar) {
          tampilnoNotif(browser.i18n.getMessage("historyRefreshInstruction") || "Please play the video to refresh the link");
        }
        setTimeout(() => {
          browser.tabs.create({ url: item.pageUrl });
        }, 2000);
      });
      actions.appendChild(visitBtn);
    }

    const downloadBtn = document.createElement('mdui-button-icon');
    downloadBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg></mdui-icon>`;
    downloadBtn.title = browser.i18n.getMessage("downloadMedia") || "Download";
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      browser.storage.local.get(['download-method', 'gdrive-stream', 'save-to-gdrive', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token'], (res) => {
        let method = res['download-method'] || 'browser';
        const isGdriveStream = res['save-to-gdrive'] === '1' && res['gdrive-stream'] === '1' && res['gdrive_token'];
        const isDropboxStream = res['save-to-dropbox'] === '1' && res['dropbox-stream'] === '1' && res['dropbox_token'];

        if (isGdriveStream || isDropboxStream) method = 'fetch';

        if (method === 'fetch') {
          browser.runtime.sendMessage({
            action: 'startFetchDownload',
            url: item.url,
            filename: item.filename,
            mediaType: item.mediaType || getMediaType(item.url, [])
          });
          if (typeof mdui !== 'undefined' && mdui.snackbar) {
            tampilnoNotif(browser.i18n.getMessage("downloadStartedSnackbar") || "Download started...");
          }
        } else {
          browser.downloads.download({
            url: item.url,
            filename: item.filename,
            saveAs: false
          });
        }
      });
    });
    actions.appendChild(downloadBtn);

    const qrHistoryBtn = document.createElement('mdui-button-icon');
    qrHistoryBtn.innerHTML = `<mdui-icon><svg viewBox="0 -960 960 960"><path d="M120-120v-240h80v160h160v80H120Zm0-480v-240h240v80H200v160h-80Zm480 480v-80h160v-160h80v240H600Zm160-480v-160H600v-80h240v240h-80ZM280-280v-120h120v120H280Zm0-280v-120h120v120H280Zm280 280v-120h120v120H560Zm0-280v-120h120v120H560Z"/></svg></mdui-icon>`;
    qrHistoryBtn.title = browser.i18n.getMessage("qrCodeButton") || "QR Code";
    qrHistoryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showQRCode(item.url);
    });

    const deleteBtn = document.createElement('mdui-button-icon');
    deleteBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></mdui-icon>`;
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentHistory = (await browser.storage.local.get('download-history'))['download-history'] || [];
      currentHistory.splice(index, 1);
      await browser.storage.local.set({ 'download-history': currentHistory });
      loadHistoryList();
    });

    actions.appendChild(linkBtn);
    actions.appendChild(qrHistoryBtn);
    actions.appendChild(deleteBtn);
    header.appendChild(actions);

    historyItem.appendChild(header);
    historyContainer.appendChild(historyItem);
  });

  if (visibleCount > historyRenderLimit) {
    const sentinel = document.createElement('div');
    sentinel.className = 'history-scroll-sentinel';
    sentinel.style.height = '20px';
    historyContainer.appendChild(sentinel);
    historyIntersectionObserver = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      historyIntersectionObserver.disconnect();
      historyRenderLimit += HISTORY_CHUNK_SIZE;
      loadHistoryList(false);
    }, { rootMargin: '240px' });
    historyIntersectionObserver.observe(sentinel);
  } else if (visibleCount === 0 && history.length > 0) {
    historyContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noHistory") || "No items found for the current filters."}</div>`;
  }
}

async function clearHistory() {
  await browser.storage.local.remove('download-history');
  loadHistoryList();
}

async function exportHistory() {
  const historyResult = await browser.storage.local.get('download-history');
  const history = historyResult['download-history'] || [];
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `wmd-history-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImportHistory(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error('Invalid format');
    const existing = (await browser.storage.local.get('download-history'))['download-history'] || [];
    const merged = [...imported, ...existing];
    await browser.storage.local.set({ 'download-history': merged });
    loadHistoryList();
    if (typeof mdui !== 'undefined' && mdui.snackbar) {
      tampilnoNotif(browser.i18n.getMessage('historyImportSuccess') || 'History imported successfully!');
    }
  } catch (err) {
    if (typeof mdui !== 'undefined' && mdui.snackbar) {
      tampilnoNotif(browser.i18n.getMessage('historyImportError', [err.message]) || `Failed to import history: ${err.message}`);
    }
  }
}
