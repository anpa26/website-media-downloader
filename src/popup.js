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

// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
  var browser = chrome;
}

let downloadingCount = 0;
let ratingCount = 0;
let allMediaRequests = []; // Global storage for filtering
sessionStorage.setItem('shownYoutubeAlert', 0); 

document.addEventListener('DOMContentLoaded', async () => {
  const colorResult = await browser.storage.local.get('theme-color');
  mdui.setColorScheme(colorResult['theme-color'] || '#bbdefb');

  // Restore state if reloaded
  const savedTab = sessionStorage.getItem('activeTab');
  const savedScroll = sessionStorage.getItem('scrollPos');
  if (savedTab) {
    document.getElementById('navbar').value = savedTab;
    if (savedTab === 'history') loadHistoryList();
    if (savedTab === 'about') loadAboutPage();
  }
  if (savedScroll) {
    window.scrollTo(0, parseInt(savedScroll));
  }

  loadMediaList();
  
  // Search bar logic
  document.getElementById('search-bar').addEventListener('input', (e) => {
    filterAndRenderMediaList(e.target.value);
  });

  // Select all logic
  document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const items = document.querySelectorAll('.media-item:not([style*="display: none"])');
    items.forEach(item => {
      const cb = item.querySelector('.media-checkbox');
      if (cb) cb.checked = isChecked;
    });
    updateSelectedCount();
  });

  // Download selected logic
  document.getElementById('download-selected').addEventListener('click', async () => {
    const allCheckboxes = document.querySelectorAll('.media-item .media-checkbox');
    const selectedCheckboxes = Array.from(allCheckboxes).filter(cb => cb.checked);
    if (selectedCheckboxes.length === 0) return;

    for (const cb of selectedCheckboxes) {
      const itemElement = cb.closest('.media-item');
      const url = itemElement.dataset.url;
      const size = itemElement.dataset.size;
      await downloadFile(url, itemElement, size, true); 
    }
  });

  // Download all logic
  document.getElementById('download-all').addEventListener('click', async () => {
    const items = document.querySelectorAll('.media-item');
    const visibleItems = Array.from(items).filter(item => item.style.display !== 'none');
    if (visibleItems.length === 0) return;

    for (const itemElement of visibleItems) {
      const url = itemElement.dataset.url;
      const size = itemElement.dataset.size;
      // Skip if already downloading
      if (itemElement.querySelector('mdui-linear-progress')) continue;
      await downloadFile(url, itemElement, size, true);
    }
  });

  // Delete selected logic
  document.getElementById('delete-selected').addEventListener('click', async () => {
    const allCheckboxes = document.querySelectorAll('.media-item .media-checkbox');
    const selectedCheckboxes = Array.from(allCheckboxes).filter(cb => cb.checked);
    if (selectedCheckboxes.length === 0) return;

    for (const cb of selectedCheckboxes) {
      const itemElement = cb.closest('.media-item');
      const url = itemElement.dataset.url;
      
      // Remove from background storage
      browser.runtime.sendMessage({ action: 'removeMedia', url: url });
      
      // Remove from UI
      itemElement.remove();
    }
    
    updateSelectedCount();
    
    const mediaContainer = document.getElementById('media-list');
    if (mediaContainer.querySelectorAll('.media-item').length === 0) {
      mediaContainer.innerHTML = `<div id="no-media-detected" style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noMediaDetected")}</div>`;
    }
  });

  // Cancel selected logic
  document.getElementById('cancel-selected').addEventListener('click', () => {
    const allCheckboxes = document.querySelectorAll('.media-item .media-checkbox');
    const selectedCheckboxes = Array.from(allCheckboxes).filter(cb => cb.checked);
    selectedCheckboxes.forEach(cb => {
      const itemElement = cb.closest('.media-item');
      if (itemElement.querySelector('mdui-linear-progress')) {
        const url = itemElement.dataset.url;
        browser.runtime.sendMessage({ action: 'cancelDownload', url: url });
        
        // Immediate UI feedback
        const dlBtn = itemElement.querySelector('#download-button');
        if (dlBtn) dlBtn.disabled = true;
        const statusInfo = itemElement.querySelector('.download-status-info');
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("downloadCancelled") || "Cancelling...";
      }
    });
  });

  // Cancel all logic
  document.getElementById('cancel-all').addEventListener('click', () => {
    const activeItems = document.querySelectorAll('.media-item mdui-linear-progress');
    activeItems.forEach(progress => {
      const itemElement = progress.closest('.media-item');
      const url = itemElement.dataset.url;
      browser.runtime.sendMessage({ action: 'cancelDownload', url: url });
      
      const dlBtn = itemElement.querySelector('#download-button');
      if (dlBtn) dlBtn.disabled = true;
      const statusInfo = itemElement.querySelector('.download-status-info');
      if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("downloadCancelled") || "Cancelling...";
    });
  });

  document.getElementById('navbar').addEventListener('change', (event) => {
    const selectedTab = document.getElementById('navbar').value;
    sessionStorage.setItem('activeTab', selectedTab);
    if (selectedTab === 'history') {
      loadHistoryList();
    } else if (selectedTab === 'about') {
      loadAboutPage();
    }
  });

  const historyPageResult = await browser.storage.local.get('history-page');
  if (historyPageResult['history-page'] === '1') {
    document.getElementById('history-tab').style.display = 'inline-flex';
  }

  // Watch for history-page setting changes
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['history-page']) {
      // Save current state before reload
      sessionStorage.setItem('activeTab', document.getElementById('navbar').value);
      sessionStorage.setItem('scrollPos', window.scrollY);
      location.reload();
    }
  });

  document.getElementById('clear-history').addEventListener('click', () => clearHistory());


  document.getElementById('refresh-list').addEventListener('click', () => loadMediaList());
  document.getElementById('clear-list').addEventListener('click', () => clearMediaList());

  document.getElementById('help-button').addEventListener('click', async () => {
    try {
      const response = await fetch(browser.runtime.getURL('changelog.json'));
      const data = await response.json();
      const lang = browser.i18n.getUILanguage().split('-')[0];
      const content = data[lang] || data['en'];
      const version = browser.runtime.getManifest().version;
      
      const headlineHtml = `
        <div style="display: flex; align-items: baseline; justify-content: space-between; width: 100%;">
          <span>${content.headline}</span>
          <span style="opacity: 0.5; font-size: 0.8rem; font-weight: normal; margin-left: 16px;">v${version}</span>
        </div>`;
        
      const changelogHtml = `<ul style="padding-left: 20px; margin: 0;">${content.changes.map(change => `<li>${change}</li>`).join('')}</ul>`;
      
      const githubButton = document.createElement('mdui-button');
      githubButton.variant = "text";
      githubButton.href = "https://github.com/anpa26/website-media-downloader";
      githubButton.target = "_blank";
      githubButton.style.marginRight = "auto";
      githubButton.style.marginLeft = "-8px";
      githubButton.innerHTML = `
        <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> GitHub Repository
      `;

      showDialog(changelogHtml, headlineHtml, [githubButton]);
    } catch (e) {
      console.error("Failed to load changelog:", e);
      const githubButton = document.createElement('mdui-button');
      githubButton.variant = "text";
      githubButton.href = "https://github.com/anpa26/website-media-downloader";
      githubButton.target = "_blank";
      githubButton.style.marginRight = "auto";
      githubButton.style.marginLeft = "-8px";
      githubButton.innerHTML = `
        <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> GitHub Repository
      `;
      showDialog("Visit our GitHub for the latest updates.", "Changelog", [githubButton]);
    }
  });

  checkAndShowRatingBanner();
  document.getElementById('dont-show-again-button').addEventListener('click', () => dismissRatingBanner());

  document.getElementById('remind-me-later-button').addEventListener('click', async () => {
    const ratingBanner = document.getElementById('rating-banner');
    ratingBanner.style.display = 'none';
    await browser.storage.local.set({ 'install-date': Temporal.Now.plainDateISO().toString() });
  });

  document.getElementById('rate-now-button').addEventListener('click', async () => {
    res = await fetch("https://addons.mozilla.org/api/v5/addons/addon/media-downloader-unleashed/");
    data = await res.json();
    ratingCount = data.ratings.count;
    await browser.storage.local.set({ 'ratings-at-attempt': ratingCount.toString() });
    onfocus = async () => {
      res = await fetch("https://addons.mozilla.org/api/v5/addons/addon/media-downloader-unleashed/");
      data = await res.json();
      if (data.ratings.count > ratingCount) dismissRatingBanner();
      await browser.storage.local.remove("ratings-at-attempt");
      onfocus = null;
    };
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('options') === 'true') {
    document.getElementById('navbar').value = 'settings';
  } else if (urlParams.get('tab') === 'history') {
    document.getElementById('navbar').value = 'history';
    loadHistoryList();
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'downloadProgress') {
    updateProgressUI(message.id || message.url, message.loaded, message.total);
  } else if (message.action === 'downloadComplete') {
    finishDownloadUI(message.id || message.url, true);
  } else if (message.action === 'downloadError') {
    finishDownloadUI(message.id || message.url, false);
    if (message.error === "USER_CANCELED") {
      if (typeof mdui !== 'undefined' && mdui.snackbar) {
        mdui.snackbar({
          message: browser.i18n.getMessage("downloadCancelled") || "Download cancelled",
          placement: "top"
        });
      }
      return;
    }
    showDialog(browser.i18n.getMessage("downloadError", [message.error]) || ("Download error: " + message.error));
  }
});

const uiCache = new Map();

function updateProgressUI(id, loaded, total) {
  let item = uiCache.get(id);
  
  if (!item) {
    const mediaItems = document.querySelectorAll('.media-item');
    for (const el of mediaItems) {
      if (el.dataset.downloadId === id || el.dataset.url === id) {
        const loadingBar = el.querySelector('mdui-linear-progress');
        const statusInfo = el.querySelector('.download-status-info');
        if (loadingBar && statusInfo) {
          item = { loadingBar, statusInfo, element: el };
          uiCache.set(id, item);
          // Also cache by the other identifier if possible
          if (el.dataset.downloadId) uiCache.set(el.dataset.downloadId, item);
          if (el.dataset.url) uiCache.set(el.dataset.url, item);
        }
        break;
      }
    }
  }

  if (item) {
    const { loadingBar, statusInfo } = item;
    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
    if (total > 0) {
      const totalMB = (total / (1024 * 1024)).toFixed(2);
      const percent = Math.round((loaded / total) * 100);
      const remainingMB = ((total - loaded) / (1024 * 1024)).toFixed(2);
      statusInfo.textContent = `${loadedMB} MB / ${totalMB} MB (${percent}%) • ${remainingMB} MB remaining`;
      loadingBar.indeterminate = false;
      loadingBar.max = total;
      loadingBar.value = loaded;
    } else {
      statusInfo.textContent = `${loadedMB} MB downloaded`;
      if (loadingBar.indeterminate !== true && !loadingBar.value) {
          loadingBar.indeterminate = true;
      }
    }
  }
}

function finishDownloadUI(id, isSuccess = false) {
  const itemData = uiCache.get(id);
  if (itemData) {
      const { element, loadingBar, statusInfo } = itemData;
      
      const isPreviewing = element.classList.contains('expanded') || 
                          element.querySelector('.media-preview-container.playing');

      if (isSuccess && !isPreviewing) {
          // Remove from list if download was successful and not being previewed
          element.parentNode.removeChild(element);
          
          // Check if list is empty now
          const mediaContainer = document.getElementById('media-list');
          if (mediaContainer.querySelectorAll('.media-item').length === 0) {
            mediaContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noMediaDetected")}</div>`;
          }
      } else {
          // Standard cleanup if failed or being previewed
          if (loadingBar && loadingBar.parentNode === element) element.removeChild(loadingBar);
          if (statusInfo && statusInfo.parentNode === element) element.removeChild(statusInfo);
          
          const dlBtn = element.querySelector('#download-button');
          if (dlBtn) {
            dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>Download`;
            dlBtn.classList.remove('cancel-active');
            dlBtn.disabled = false;
          }
      }
      uiCache.delete(id);
      updateDownloadingCount(-1);
      return;
  }
  
  // Fallback if not in cache
  const mediaItems = document.querySelectorAll('.media-item');
  mediaItems.forEach(item => {
    if (item.dataset.downloadId === id || item.dataset.url === id) {
      const isPreviewing = item.classList.contains('expanded') || 
                          item.querySelector('.media-preview-container.playing');

      if (isSuccess && !isPreviewing) {
        item.parentNode.removeChild(item);
        
        const mediaContainer = document.getElementById('media-list');
        if (mediaContainer.querySelectorAll('.media-item').length === 0) {
          mediaContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noMediaDetected")}</div>`;
        }
      } else {
        const loadingBar = item.querySelector('mdui-linear-progress');
        const statusInfo = item.querySelector('.download-status-info');
        if (loadingBar) item.removeChild(loadingBar);
        if (statusInfo) item.removeChild(statusInfo);

        const dlBtn = item.querySelector('#download-button');
        if (dlBtn) {
          dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>Download`;
          dlBtn.classList.remove('cancel-active');
          dlBtn.disabled = false;
        }
      }

      updateDownloadingCount(-1);
    }
  });
}

async function checkAndShowRatingBanner() {
  if(typeof Temporal !== 'undefined') {
    const installData = await browser.storage.local.get('install-date');
    if (!installData['install-date']) {
      await browser.storage.local.set({ 'install-date': Temporal.Now.plainDateISO().toString() });
      return;
    }
    const installDate = Temporal.PlainDate.from(installData['install-date']);
    const hasRated = (await browser.storage.local.get('has-rated'))['has-rated'];
    const now = Temporal.Now.plainDateISO();
    if (now.since(installDate).days >= 7 && !hasRated) {
      document.getElementById('rating-banner').removeAttribute("style");
    }
  }
}

async function dismissRatingBanner() {
  document.getElementById('rating-banner').style.display = 'none';
  await browser.storage.local.set({ 'has-rated': 'true' });
}

function updateDownloadingCount(change) {
  downloadingCount = Math.max(0, downloadingCount + change);
  document.title = downloadingCount > 0 ? `${downloadingCount}` : "Website Media Downloader";
  
  const cancelAllBtn = document.getElementById('cancel-all');
  if (cancelAllBtn) {
    cancelAllBtn.style.display = downloadingCount > 0 ? 'inline-flex' : 'none';
  }
}

function showDialog(message, title = null, extraActions = []) {
  const dialog = document.createElement('mdui-dialog');
  
  if (title && typeof title === 'string' && title.includes('<')) {
    const headline = document.createElement('div');
    headline.setAttribute('slot', 'headline');
    headline.style.width = '100%';
    headline.innerHTML = title;
    dialog.appendChild(headline);
  } else {
    dialog.headline = title || "Changelog";
  }

  const description = document.createElement('div');
  description.setAttribute('slot', 'description');
  description.innerHTML = message;
  dialog.appendChild(description);

  if (Array.isArray(extraActions)) {
    extraActions.forEach(action => {
      action.setAttribute('slot', 'action');
      dialog.appendChild(action);
    });
  }

  const okButton = document.createElement('mdui-button');
  okButton.variant = "text";
  okButton.textContent = browser.i18n.getMessage("okButton") || "OK";
  okButton.slot = 'action';
  okButton.style.marginRight = "-8px";
  okButton.addEventListener('click', () => {
    dialog.open = false;
  });
  dialog.appendChild(okButton);
  
  document.body.appendChild(dialog);
  dialog.open = true;

  dialog.addEventListener('closed', () => {
    dialog.remove();
  });
}

function showQRCode(url) {
  const typeNumber = 0;
  const errorCorrectionLevel = 'L';
  const qr = qrcode(typeNumber, errorCorrectionLevel);
  qr.addData(url);
  qr.make();
  
  const qrImageTag = qr.createImgTag(5);
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.gap = '16px';
  container.style.padding = '16px 0';
  container.innerHTML = `
    <div style="background: white; padding: 12px; border-radius: 8px;">
      ${qrImageTag}
    </div>
    <div style="word-break: break-all; font-size: 12px; opacity: 0.7; text-align: center; max-width: 250px;">
      ${url}
    </div>
  `;
  
  showDialog(container.outerHTML, browser.i18n.getMessage("qrCodeDialogTitle") || "Scan QR Code");
}

function updateSelectedCount() {
  const allCheckboxes = document.querySelectorAll('.media-item .media-checkbox');
  const selectedItems = Array.from(allCheckboxes).filter(cb => cb.checked);
  const selectedCount = selectedItems.length;
  
  document.getElementById('selected-count').textContent = `${selectedCount} selected`;
  const downloadSelectedBtn = document.getElementById('download-selected');
  const deleteSelectedBtn = document.getElementById('delete-selected');
  const cancelSelectedBtn = document.getElementById('cancel-selected');
  
  const hasActiveSelected = selectedItems.some(cb => 
    cb.closest('.media-item').querySelector('mdui-linear-progress')
  );

  if (selectedCount > 0) {
    downloadSelectedBtn.style.display = 'inline-flex';
    deleteSelectedBtn.style.display = 'inline-flex';
    cancelSelectedBtn.style.display = hasActiveSelected ? 'inline-flex' : 'none';
  } else {
    downloadSelectedBtn.style.display = 'none';
    deleteSelectedBtn.style.display = 'none';
    cancelSelectedBtn.style.display = 'none';
  }
}

function filterAndRenderMediaList(query = '') {
  const mediaContainer = document.getElementById('media-list');
  const items = mediaContainer.querySelectorAll('.media-item');
  const endMsg = document.getElementById('end-of-media-list');
  const noMediaDetectedMsg = document.getElementById('no-media-detected');
  const lowerQuery = query.trim().toLowerCase();

  // Hide the initial "No media detected" message if we are searching
  if (noMediaDetectedMsg) {
    noMediaDetectedMsg.style.display = lowerQuery ? 'none' : 'block';
  }

  let visibleCount = 0;
  items.forEach(item => {
    // Get text content safely
    const headline = (item.querySelector('[slot="headline"]')?.textContent || '').toLowerCase();
    const description = (item.querySelector('[slot="description"]')?.textContent || '').toLowerCase();
    const url = (item.dataset.url || '').toLowerCase();
    
    // Check if query matches title, description, or URL/extension
    const isMatch = !lowerQuery || 
                    headline.includes(lowerQuery) || 
                    description.includes(lowerQuery) || 
                    url.includes(lowerQuery);
    
    if (isMatch) {
      item.style.setProperty('display', 'flex', 'important');
      visibleCount++;
    } else {
      item.style.setProperty('display', 'none', 'important');
      // Uncheck hidden items to avoid accidental downloads
      const cb = item.querySelector('.media-checkbox');
      if (cb) cb.checked = false;
    }
  });

  // Handle "No matches found" message
  let noMatchesMsg = document.getElementById('no-matches-msg');
  if (visibleCount === 0 && lowerQuery) {
    if (!noMatchesMsg) {
      noMatchesMsg = document.createElement('div');
      noMatchesMsg.id = 'no-matches-msg';
      noMatchesMsg.style.padding = '60px 20px';
      noMatchesMsg.style.textAlign = 'center';
      noMatchesMsg.style.opacity = '0.8';
      noMatchesMsg.textContent = 'No matches found for "' + query + '"';
      mediaContainer.appendChild(noMatchesMsg);
    }
  } else if (noMatchesMsg) {
    noMatchesMsg.remove();
  }

  // Hide end message if searching or if no items match
  if (endMsg) {
    if (lowerQuery || visibleCount === 0) {
      endMsg.style.display = 'none';
    } else {
      endMsg.style.display = 'block';
    }
  }
  
  updateSelectedCount();
}

function loadMediaList() {
  const mediaContainer = document.getElementById('media-list');
  const loadingSpinner = document.getElementById('loading-media-list');
  const globalLoading = document.getElementById('loading');
  const mainContent = document.getElementById('main-content');
  const mediaControls = document.getElementById('media-controls');

  if (loadingSpinner) loadingSpinner.style.display = 'block';
  
  // Reset search and select all
  document.getElementById('search-bar').value = '';
  document.getElementById('select-all-checkbox').checked = false;
  updateSelectedCount();

  // Preserve active download items to avoid flickering
  const activeItems = new Map();
  mediaContainer.querySelectorAll('.media-item').forEach(item => {
    if (item.querySelector('mdui-linear-progress')) {
      activeItems.set(item.dataset.url, item);
    }
  });

  mediaContainer.innerHTML = ''; 
  activeItems.forEach(item => mediaContainer.appendChild(item));

  browser.runtime.sendMessage({ action: 'getMediaRequests' }).then(async (mediaRequests) => {
    if (globalLoading) globalLoading.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
    
    if (!mediaRequests || Object.keys(mediaRequests).length === 0) {
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        if (activeItems.size === 0) {
          mediaContainer.innerHTML = `<div id="no-media-detected" style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noMediaDetected")}</div>`;
          if (mediaControls) mediaControls.style.display = 'none';
        } else {
          if (mediaControls) mediaControls.style.display = 'flex';
        }
        return;
    }

    if (mediaControls) mediaControls.style.display = 'flex';

    const onlyMedia = (await browser.storage.local.get('only-media'))['only-media'] !== '0'; // Default to true
    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"]
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa"];

    const mediaGroups = new Map();
    for (const rawUrl in mediaRequests) {
      if (activeItems.has(rawUrl)) continue;

      let mediaURL;
      try { mediaURL = new URL(rawUrl); } catch (e) { continue; }
      const requests = mediaRequests[rawUrl];
      if (!Array.isArray(requests) || requests.length === 0) continue;

      const path = mediaURL.pathname.toLowerCase();
      const isVideo = videoExtensions.some(ext => path.endsWith(ext)) || requests.some(req => req.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && h.value.startsWith("video/")));
      const isAudio = audioExtensions.some(ext => path.endsWith(ext)) || requests.some(req => req.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && h.value.startsWith("audio/")));
      const isStream = streamExtensions.some(ext => path.endsWith(ext)) || requests.some(req => req.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && (h.value.includes("mpegurl") || h.value.includes("dash+xml"))));
      const isSubtitle = subtitleExtensions.some(ext => path.endsWith(ext)) || requests.some(req => req.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && (h.value.includes("vtt") || h.value.includes("subrip") || h.value.includes("ass"))));

      if (onlyMedia && !isVideo && !isAudio && !isStream && !isSubtitle) continue;
      
      // Use URL without common tracking params as identity to distinguish qualities
      const identity = rawUrl.split('?')[0]; 
      if (!mediaGroups.has(identity)) mediaGroups.set(identity, { requests: [], isVideo, isAudio, isStream, isSubtitle });
      const group = mediaGroups.get(identity);
      
      requests.forEach(req => {
        const existingIdx = group.requests.findIndex(r => r.originalUrl === rawUrl);
        if (existingIdx === -1) {
          group.requests.push({ ...req, originalUrl: rawUrl });
        } else {
          // If we see the same URL again, keep the one with the larger size (better detection)
          const currentSize = parseInt(req.size) || 0;
          const existingSize = parseInt(group.requests[existingIdx].size) || 0;
          if (currentSize > existingSize) {
            group.requests[existingIdx] = { ...req, originalUrl: rawUrl };
          }
        }
      });
    }

    // Flatten and sort globally by size
    const flattenedRequests = [];
    mediaGroups.forEach(group => {
        group.requests.sort((a, b) => (parseInt(b.size) || 0) - (parseInt(a.size) || 0));
        flattenedRequests.push({ 
          bestRequest: group.requests[0], 
          isVideo: group.isVideo, 
          isAudio: group.isAudio, 
          isStream: group.isStream,
          isSubtitle: group.isSubtitle
        });
    });
    
    flattenedRequests.sort((a, b) => (parseInt(b.bestRequest.size) || 0) - (parseInt(a.bestRequest.size) || 0));
    allMediaRequests = flattenedRequests; // Store for filtering if needed later

    if (flattenedRequests.length === 0 && activeItems.size === 0) {
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      mediaContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noMediaDetected")}</div>`;
      return;
    }

    for (const item of flattenedRequests) {
      const { bestRequest, isVideo, isAudio, isStream, isSubtitle } = item;
      const mediaURL = new URL(bestRequest.originalUrl);
      const mediaDiv = document.createElement('mdui-list-item');
      mediaDiv.setAttribute('nonclickable', 'true');
      mediaDiv.classList.add('media-item');
      mediaDiv.dataset.url = bestRequest.originalUrl; // Set for progress tracking
      mediaDiv.dataset.size = bestRequest.size;

      // Checkbox for multi-select
      const checkbox = document.createElement('mdui-checkbox');
      checkbox.classList.add('media-checkbox');
      checkbox.setAttribute('slot', 'icon');
      checkbox.style.marginRight = '8px';
      checkbox.addEventListener('change', () => updateSelectedCount());
      mediaDiv.appendChild(checkbox);

      const previewContainer = document.createElement('div');
      previewContainer.classList.add('media-preview-container');
      // Changed to 'icon' slot too, but MDUI might have issues with multiple items in slot.
      // Let's use a wrapper for the icon slot.
      const iconWrapper = document.createElement('div');
      iconWrapper.setAttribute('slot', 'icon');
      iconWrapper.style.display = 'flex';
      iconWrapper.style.alignItems = 'center';
      iconWrapper.appendChild(checkbox);
      iconWrapper.appendChild(previewContainer);
      mediaDiv.appendChild(iconWrapper);

      if (isVideo || isStream) {
        previewContainer.classList.add('video');
        const video = document.createElement('video');
        video.src = isStream ? "" : bestRequest.originalUrl;
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        if (!isStream) video.currentTime = 0.1;
        previewContainer.appendChild(video);
        
        let hls = null;
        previewContainer.addEventListener('click', (e) => {
          e.stopPropagation();
          if (video.paused) {
            // Pause all other playing videos first
            document.querySelectorAll('.media-preview-container.playing video').forEach(v => {
              v.pause();
              v.parentElement.classList.remove('playing');
            });

            if (isStream && !video.src) {
              if (Hls.isSupported()) {
                hls = new Hls();
                hls.loadSource(bestRequest.originalUrl);
                hls.attachMedia(video);
              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = bestRequest.originalUrl;
              }
            }
            
            video.muted = false;
            video.play().then(() => {
              previewContainer.classList.add('playing');
            }).catch(err => console.error("Playback failed:", err));
          } else {
            video.pause();
            previewContainer.classList.remove('playing');
          }
        });
      } else {
        const mediaIconContainer = document.createElement('mdui-icon');
        mediaIconContainer.classList.add('media-preview-icon');
        const mediaIcon = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
        mediaIcon.setAttribute('viewBox', '0 -960 960 960');
        let path = document.createElementNS("http://www.w3.org/2000/svg", 'path');

        if (isAudio) {
          path.setAttribute('d', 'M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z');
        } else if (isSubtitle) {
          path.setAttribute('d', 'M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm120-120h120v-40H280v40Zm0-80h120v-40H280v40Zm280 80h120v-40H560v40Zm0-80h120v-40H560v40ZM160-240v-480 480Z');
        } else {
          path.setAttribute('d', 'M40-480q0-92 34.5-172T169-791.5q60-59.5 140-94T480-920q91 0 171 34.5t140 94Q851-732 885.5-652T920-480h-80q0-75-28.5-140.5T734-735q-49-49-114.5-77T480-840q-74 0-139.5 28T226-735q-49 49-77.5 114.5T120-480H40Zm160 0q0-118 82-199t198-81q116 0 198 81t82 199h-80q0-83-58.5-141.5T480-680q-83 0-141.5 58.5T280-480h-80ZM360-64l-56-56 136-136v-132q-27-12-43.5-37T380-480q0-42 29-71t71-29q42 0 71 29t29 71q0 30-16.5 55T520-388v132l136 136-56 56-120-120L360-64Z');
        }
        mediaIcon.appendChild(path);
        mediaIconContainer.appendChild(mediaIcon);
        previewContainer.appendChild(mediaIconContainer);
      }
      mediaDiv.appendChild(previewContainer);

      const cardContent = document.createElement('div');
      cardContent.classList.add('media-item-content');

      const headline = document.createElement('div');
      headline.setAttribute('slot', 'headline');
      headline.textContent = getFileName(bestRequest.originalUrl);
      cardContent.appendChild(headline);

      const description = document.createElement('div');
      description.setAttribute('slot', 'description');
      const timeStr = new Date(bestRequest.timeStamp).toLocaleTimeString();
      const humanSize = getHumanReadableSize(bestRequest.size);
      description.textContent = `${mediaURL.hostname} • ${humanSize} • ${timeStr}`;
      cardContent.appendChild(description);

      const qrBtn = document.createElement('mdui-button-icon');
      qrBtn.style.position = 'absolute';
      qrBtn.style.right = '4px';
      qrBtn.style.top = '12px';
      qrBtn.style.opacity = '0.6';
      qrBtn.innerHTML = `<mdui-icon><svg viewBox="0 -960 960 960"><path d="M120-120v-240h80v160h160v80H120Zm0-480v-240h240v80H200v160h-80Zm480 480v-80h160v-160h80v240H600Zm160-480v-160H600v-80h240v240h-80ZM280-280v-120h120v120H280Zm0-280v-120h120v120H280Zm280 280v-120h120v120H560Zm0-280v-120h120v120H560Z"/></svg></mdui-icon>`;
      qrBtn.title = browser.i18n.getMessage("qrCodeButton") || "QR Code";
      qrBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showQRCode(bestRequest.originalUrl);
      });
      cardContent.appendChild(qrBtn);

      const inlinePreview = document.createElement('div');
      inlinePreview.classList.add('inline-preview-area');
      const largeVideo = document.createElement('video');
      largeVideo.controls = true;
      inlinePreview.appendChild(largeVideo);
      mediaDiv.appendChild(inlinePreview);

      mediaDiv.appendChild(cardContent);

      const actionsArea = document.createElement('div');
      actionsArea.classList.add('media-actions');
      cardContent.appendChild(actionsArea);

      const buttonGroup = document.createElement('mdui-segmented-button-group');
      buttonGroup.style.width = '100%';

      const dlBtn = document.createElement('mdui-segmented-button');
      dlBtn.id = 'download-button';
      dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>Download`;
      dlBtn.addEventListener('click', () => {
        if (dlBtn.classList.contains('cancel-active')) {
          browser.runtime.sendMessage({ action: 'cancelDownload', url: bestRequest.originalUrl });
          // Provide immediate feedback
          dlBtn.disabled = true;
          const statusInfo = mediaDiv.querySelector('.download-status-info');
          if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("downloadCancelled") || "Cancelling...";
        } else {
          downloadFile(bestRequest.originalUrl, mediaDiv, bestRequest.size);
        }
      });
      
      const prvBtn = document.createElement('mdui-segmented-button');
      prvBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="m380-300 280-180-280-180v360ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg></mdui-icon>Preview`;
      if (isSubtitle) prvBtn.style.display = 'none';
      
      let hlsLarge = null;
      prvBtn.addEventListener('click', () => {
          const isExpanded = mediaDiv.classList.toggle('expanded');
          
          if (isExpanded) {
            if (isStream) {
              if (Hls.isSupported()) {
                hlsLarge = new Hls();
                hlsLarge.loadSource(bestRequest.originalUrl);
                hlsLarge.attachMedia(largeVideo);
              } else if (largeVideo.canPlayType('application/vnd.apple.mpegurl')) {
                largeVideo.src = bestRequest.originalUrl;
              }
            } else {
              largeVideo.src = bestRequest.originalUrl;
            }
            largeVideo.play().catch(e => console.warn("Auto-play failed:", e));
            prvBtn.setAttribute('selected', '');
          } else {
            largeVideo.pause();
            largeVideo.src = "";
            if (hlsLarge) {
              hlsLarge.destroy();
              hlsLarge = null;
            }
            prvBtn.removeAttribute('selected');
          }
      });

      const audioBtn = document.createElement('mdui-segmented-button');
      audioBtn.id = 'audio-only-button';
      audioBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z"/></svg></mdui-icon>${browser.i18n.getMessage("audioOnly") || "Audio-Only"}`;
      audioBtn.addEventListener('click', () => {
        downloadAudioOnly(bestRequest.originalUrl, mediaDiv, bestRequest.size);
      });
      if (!isVideo && !isStream) audioBtn.style.display = 'none';

      buttonGroup.appendChild(dlBtn);
      buttonGroup.appendChild(audioBtn);
      buttonGroup.appendChild(prvBtn);
      actionsArea.appendChild(buttonGroup);
      mediaContainer.appendChild(mediaDiv);
    }

    if (loadingSpinner) loadingSpinner.style.display = 'none';
    const endMsg = document.createElement('div');
    endMsg.id = "end-of-media-list";
    endMsg.style.textAlign = 'center';
    endMsg.style.padding = '20px 0 100px';
    endMsg.innerHTML = browser.i18n.getMessage("endOfMediaList");
    mediaContainer.appendChild(endMsg);

    // Restore active downloads UI
    browser.runtime.sendMessage({ action: 'getActiveDownloads' }).then((activeDownloads) => {
      if (!activeDownloads) return;
      Object.keys(activeDownloads).forEach(id => {
        const downloadData = activeDownloads[id];
        const url = downloadData.url;

        // Find the item. Match by id if available, or by URL
        const item = Array.from(document.querySelectorAll('.media-item')).find(el =>
          el.dataset.downloadId === id || el.dataset.url === url || url.startsWith(el.dataset.url.split('?')[0])
        );

        if (item && !item.querySelector('mdui-linear-progress')) {
          item.dataset.downloadId = id; // Sync with background ID
          item.dataset.url = url; 
          const loadingBar = document.createElement('mdui-linear-progress');
          const statusInfo = document.createElement('div');
          statusInfo.className = 'download-status-info';
          statusInfo.style.fontSize = '12px';
          statusInfo.style.marginTop = '4px';
          statusInfo.style.textAlign = 'center';
          item.appendChild(loadingBar);
          item.appendChild(statusInfo);

          // Restore Cancel button state
          const dlBtn = item.querySelector('#download-button');
          if (dlBtn) {
            dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></mdui-icon>${browser.i18n.getMessage("cancelButton") || "Cancel"}`;
            dlBtn.classList.add('cancel-active');
          }

          updateDownloadingCount(1);
          updateProgressUI(id, downloadData.loaded, downloadData.total);
        }
      });
    });  });
}

function clearMediaList() {
  browser.runtime.sendMessage({ action: 'clearStorage' }).then(() => loadMediaList());
}

async function loadHistoryList() {
  const historyContainer = document.getElementById('history-list');
  const historyResult = await browser.storage.local.get('download-history');
  const history = historyResult['download-history'] || [];

  historyContainer.innerHTML = '';

  if (history.length === 0) {
    historyContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noHistory") || "No download history found."}</div>`;
    return;
  }

  history.forEach((item, index) => {
    const historyItem = document.createElement('mdui-list-item');
    historyItem.setAttribute('nonclickable', 'true');
    
    const iconContainer = document.createElement('mdui-icon');
    iconContainer.setAttribute('slot', 'icon');
    iconContainer.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>`;
    historyItem.appendChild(iconContainer);

    const headline = document.createElement('div');
    headline.setAttribute('slot', 'headline');
    // Priority: use the filename (which now includes {title} from background) 
    // or fallback to the original URL-based filename
    headline.textContent = item.filename || getFileName(item.url);
    historyItem.appendChild(headline);

    const description = document.createElement('div');
    description.setAttribute('slot', 'description');
    const dateStr = new Date(item.timestamp).toLocaleString();
    // Show page title and hostname in description if available to make it easier to find
    const siteInfo = item.pageTitle ? `${item.pageTitle} • ` : "";
    description.textContent = `${siteInfo}${dateStr}`;
    historyItem.appendChild(description);

    const endIconArea = document.createElement('div');
    endIconArea.setAttribute('slot', 'end-icon');
    endIconArea.style.display = 'flex';
    endIconArea.style.gap = '4px';

    const linkBtn = document.createElement('mdui-button-icon');
    linkBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></mdui-icon>`;
    linkBtn.title = browser.i18n.getMessage("copyURL") || "Copy URL";
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(item.url).then(() => {
        if (typeof mdui !== 'undefined' && mdui.snackbar) {
          mdui.snackbar({ message: browser.i18n.getMessage("copyURLSuccess") || "URL copied to clipboard", placement: "top" });
        }
      });
    });

    const visitBtn = document.createElement('mdui-button-icon');
    if (item.pageUrl) {
      visitBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg></mdui-icon>`;
      visitBtn.title = browser.i18n.getMessage("historyVisitPage") || "Visit Page";
      visitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof mdui !== 'undefined' && mdui.snackbar) {
          mdui.snackbar({
            message: browser.i18n.getMessage("historyRefreshInstruction") || "Please play the video to refresh the link",
            placement: "top"
          });
        }
        setTimeout(() => {
          browser.tabs.create({ url: item.pageUrl });
        }, 2000);
      });
      endIconArea.appendChild(visitBtn);
    }

    const downloadBtn = document.createElement('mdui-button-icon');
    downloadBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg></mdui-icon>`;
    downloadBtn.title = browser.i18n.getMessage("downloadMedia") || "Download";
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Re-download using the stored URL (which might have been auto-updated)
      browser.storage.local.get(['download-method'], (res) => {
        const method = res['download-method'] || 'browser';
        if (method === 'fetch') {
          browser.runtime.sendMessage({ 
            action: 'startFetchDownload', 
            url: item.url, 
            filename: item.filename 
          });
          if (typeof mdui !== 'undefined' && mdui.snackbar) {
            mdui.snackbar({ message: "Download started...", placement: "top" });
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
    endIconArea.appendChild(downloadBtn);

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

    endIconArea.appendChild(linkBtn);
    endIconArea.appendChild(qrHistoryBtn);
    endIconArea.appendChild(deleteBtn);
    historyItem.appendChild(endIconArea);

    historyContainer.appendChild(historyItem);
  });
}

async function clearHistory() {
  await browser.storage.local.remove('download-history');
  loadHistoryList();
}

async function loadAboutPage() {
  const container = document.getElementById('about-container');
  try {
    const response = await fetch(browser.runtime.getURL('about.json?t=' + Date.now()));
    const data = await response.json();
    
    let html = `
      <div style="padding: 16px; display: flex; flex-direction: column; gap: 20px;">
        <div style="text-align: center;">
          <h1 style="margin: 0; font-size: 1.5rem; color: rgb(var(--mdui-color-primary));">${data.extension.name}</h1>
          <p style="opacity: 0.7; margin-top: 4px;">Version ${browser.runtime.getManifest().version}</p>
          <p style="font-size: 0.9rem; line-height: 1.5; margin-top: 12px;">${data.extension.description}</p>
        </div>
    `;

    html += `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <h2 style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: rgb(var(--mdui-color-primary)); margin: 0 8px;">Authors & Contributors</h2>
    `;

    data.authors.forEach((author) => {
      html += `
        <mdui-card variant="filled" style="padding: 16px !important; margin-bottom: 8px;">
          <div style="display: flex; gap: 16px; align-items: center;">
            <mdui-avatar src="${author.avatar}"></mdui-avatar>
            <div style="flex-grow: 1;">
              <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <b style="font-size: 1.1rem;">${author.name}</b>
                <span style="font-size: 0.75rem; opacity: 0.6; font-weight: 700; text-transform: uppercase;">${author.role}</span>
              </div>
              <p style="margin: 4px 0 8px; font-size: 0.85rem; line-height: 1.4;">${author.description}</p>
              <div style="display: flex; gap: 8px; margin-left: -12px;">
                <mdui-button variant="text" href="${author.github}" target="_blank">
                  <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> GitHub
                </mdui-button>
              </div>
            </div>
          </div>
        </mdui-card>
      `;
    });

    html += `
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <h2 style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: rgb(var(--mdui-color-primary)); margin: 8px 8px 0;">Useful Links</h2>
          <mdui-list>
    `;

    data.links.forEach(link => {
      html += `
        <mdui-list-item href="${link.url}" target="_blank">
          <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="${link.icon}"/></svg></mdui-icon>
          ${link.label}
          <mdui-icon slot="end-icon"><svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg></mdui-icon>
        </mdui-list-item>
      `;
    });

    html += `
          </mdui-list>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (error) {
    console.error("Failed to load about page:", error);
    container.innerHTML = `<div style="padding: 40px; text-align: center;">Failed to load About page information.</div>`;
  }
}

function getFileName(url, maxLength = 30) {
  try {
    let parsedUrl = new URL(url);
    let fileName = parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1).split('?')[0];
    fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if(!fileName) fileName = parsedUrl.hostname;
    if (fileName.length > maxLength) fileName = fileName.substring(0, maxLength) + '…';
    return decodeURIComponent(fileName);
  } catch (e) { return "Media File"; }
}

function getHumanReadableSize(size) {
  const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
  let sizeInBytes = parseInt(size);
  if (isNaN(sizeInBytes)) return "Unknown Size";
  let i = 0;
  while (sizeInBytes > 1024 && i < units.length - 1) { sizeInBytes /= 1024; i++; }
  return `${sizeInBytes.toFixed(2)} ${units[i]}`;
}

async function audioBufferToWav(buffer, onProgress) {
  let numOfChan = buffer.numberOfChannels,
      length = buffer.length * numOfChan * 2 + 44,
      buffer_out = new ArrayBuffer(length),
      view = new DataView(buffer_out),
      channels = [], i, sample,
      offset = 0,
      pos = 0;

  function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
  setUint32(length - pos - 4);

  for(i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
  
  const totalSamples = buffer.length;
  const batchSize = 100000; 

  while(offset < totalSamples) {
    let end = Math.min(offset + batchSize, totalSamples);
    for(; offset < end; offset++) {
      for(i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
        view.setInt16(pos, sample, true);
        pos += 2;
      }
    }
    
    if (onProgress) onProgress(offset / totalSamples);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return new Blob([buffer_out], {type: "audio/wav"});
}

async function extractAudioFromBlob(blob, filename, downloadMethod, loadingBar) {
  let statusInfo = null;
  if (loadingBar) {
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
      if (statusInfo) statusInfo.textContent = "Decoding audio... Please wait (this can be slow for large files).";
  }

  // Force a small pause so the browser has time to paint the status above
  await new Promise(r => setTimeout(r, 200));

  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      if (loadingBar) {
          loadingBar.removeAttribute('indeterminate');
          loadingBar.max = 100;
      }

      const wavBlob = await audioBufferToWav(audioBuffer, (progress) => {
          if (loadingBar) {
              const percent = Math.round(progress * 100);
              loadingBar.value = percent;
              if (statusInfo) statusInfo.textContent = `Encoding: ${percent}%`;
          }
      });
      
      const wavUrl = URL.createObjectURL(wavBlob);
      
      if (downloadMethod === "browser") {
        await browser.downloads.download({ url: wavUrl, filename: filename });
      } else {
        const a = document.createElement("a");
        a.href = wavUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      URL.revokeObjectURL(wavUrl);
  } catch (e) {
      throw new Error("Failed to extract audio. " + e.message);
  } finally {
      try { audioCtx.close(); } catch(e) {}
  }
}

async function downloadAudioOnly(url, mediaDiv, specificSize) {
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}

  try {
   const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url });
   const targetRequest = requests[url]?.find(r => r.size === specificSize) || requests[url]?.[0];
   if(!targetRequest) throw new Error("Data lost");

   const defaultName = getFileName(url, 100);
   const template = await browser.storage.local.get('filename-template').then(res => res['filename-template']);
   let finalName = defaultName;

   if (template) {
       finalName = await generateTemplateName(template, url, defaultName);
   }
   
   const lastDotIdx = finalName.lastIndexOf('.');
   let audioExt = ".wav";
   const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');

   if (lastDotIdx !== -1) {
       finalName = finalName.substring(0, lastDotIdx) + audioExt;
   } else {
       finalName += audioExt;
   }

   const newName = await showRenameDialog(finalName);
   if (newName === null) return; 

   updateDownloadingCount(1);
   const loadingBar = document.createElement('mdui-linear-progress');
   const statusInfo = document.createElement('div');
   statusInfo.className = 'download-status-info';
   statusInfo.style.fontSize = '12px';
   statusInfo.style.marginTop = '4px';
   statusInfo.style.textAlign = 'center';
   
   mediaDiv.dataset.url = url; 
   mediaDiv.appendChild(loadingBar);
   mediaDiv.appendChild(statusInfo);
   loadingBar.style.width = '100%';
   loadingBar.setAttribute('indeterminate', 'true');
   
   // Manually populate UI cache to ensure finishDownloadUI works
   uiCache.set(url, { element: mediaDiv, loadingBar, statusInfo });

   const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method']);
   const streamPref = await browser.storage.local.get('stream-download').then(res => res['stream-download'] || 'offline');

   if (isStream) {
      if (url.toLowerCase().includes('.m3u8')) {
          if (streamPref === 'offline') {
              browser.tabs.create({
                  url: browser.runtime.getURL(`stream_downloader.html?url=${encodeURIComponent(url)}&size=${encodeURIComponent(specificSize || '')}&filename=${encodeURIComponent(newName)}&audioOnly=true`),
                  active: true
              });
              finishDownloadUI(url, true);
              return;
          }
          const result = await downloadM3U8Offline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, true);
          if (result && result.blob) {
              await extractAudioFromBlob(result.blob, newName, downloadMethod, loadingBar);
          }
      } else {
          showDialog("Audio-only extraction for DASH (.mpd) is not yet supported. Only HLS (.m3u8) and direct files are supported.", "Not Supported");
          finishDownloadUI(url);
          return;
      }
   } else {
      try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          
          const contentLength = +(response.headers.get('Content-Length') || 0);
          const reader = response.body.getReader();
          let receivedLength = 0;
          let chunks = [];
          
          loadingBar.removeAttribute('indeterminate');
          if (contentLength > 0) loadingBar.max = contentLength;

          while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            
            if (contentLength > 0) {
                loadingBar.value = receivedLength;
                const percent = Math.round((receivedLength / contentLength) * 100);
                statusInfo.textContent = `Downloading: ${percent}% (${(receivedLength/1048576).toFixed(1)}MB / ${(contentLength/1048576).toFixed(1)}MB)`;
            } else {
                statusInfo.textContent = `Downloading: ${(receivedLength/1048576).toFixed(1)}MB`;
            }
          }
          
          const blob = new Blob(chunks);
          statusInfo.textContent = "Download complete. Preparing extraction...";
          await new Promise(r => setTimeout(r, 500)); // Small pause to let user see it's done
          await extractAudioFromBlob(blob, newName, downloadMethod, loadingBar);
      } catch (e) {
          throw new Error("Download failed: " + e.message);
      }
   }
   finishDownloadUI(url, true);
  } catch (error) {
    showDialog("Audio-only extraction error: " + error.message);
    finishDownloadUI(url);
  } finally {
    if (wakeLock) wakeLock.release();
  }
}

async function downloadFile(url, mediaDiv, specificSize, silent = false) {
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}

  try {
   const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url });
   const targetRequest = requests[url]?.find(r => r.size === specificSize) || requests[url]?.[0];
   if(!targetRequest) throw new Error("Data lost");

   // Update button to Cancel
   const dlBtn = mediaDiv.querySelector('#download-button');
   if (dlBtn) {
     dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></mdui-icon>${browser.i18n.getMessage("cancelButton") || "Cancel"}`;
     dlBtn.classList.add('cancel-active');
   }

   // Get default filename
   const defaultName = getFileName(url, 100);
   mediaDiv.dataset.downloadId = 'dl_' + Date.now(); // Temporary ID for UI tracking
    const template = await browser.storage.local.get('filename-template').then(res => res['filename-template']);
    let finalName = defaultName;

    if (template) {
        finalName = await generateTemplateName(template, url, defaultName);
    }

    // Show Rename Dialog (skip if silent)
    let newName = finalName;
    if (!silent) {
      newName = await showRenameDialog(finalName);
      if (newName === null) {
          finishDownloadUI(mediaDiv.dataset.downloadId);
          return;
      } // User cancelled
    }

    updateDownloadingCount(1);
    const loadingBar = document.createElement('mdui-linear-progress');
    const statusInfo = document.createElement('div');
    statusInfo.className = 'download-status-info';
    statusInfo.style.fontSize = '12px';
    statusInfo.style.marginTop = '4px';
    statusInfo.style.textAlign = 'center';

    mediaDiv.dataset.url = url; // Set for progress tracking
    mediaDiv.appendChild(loadingBar);
    mediaDiv.appendChild(statusInfo);
    loadingBar.style.width = '100%';
    loadingBar.setAttribute('indeterminate', 'true');

    // Manually populate UI cache to ensure finishDownloadUI works if started silenty
    if (silent) uiCache.set(url, { element: mediaDiv, loadingBar, statusInfo });

    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    const pageUrl = activeTab ? activeTab.url : "";
    const pageTitle = activeTab ? activeTab.title : "";

    browser.runtime.sendMessage({ 
        action: 'addToHistory', 
        item: { url, filename: newName, timestamp: Date.now(), pageUrl, pageTitle } 
    });

    const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method']);
    const streamPref = await browser.storage.local.get('stream-download').then(res => res['stream-download']);
    const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');

    if (isStream && streamPref === 'offline') {
      // Redirect to dedicated stream downloader tab
      browser.tabs.create({
        url: browser.runtime.getURL(`stream_downloader.html?url=${encodeURIComponent(url)}&size=${encodeURIComponent(specificSize || '')}&filename=${encodeURIComponent(newName)}`),
        active: true
      });
      finishDownloadUI(mediaDiv.dataset.downloadId || url);
    } else if (downloadMethod === 'browser') {
      // For Native downloads, we want to ensure it doesn't just download a chunk.
      // We can try to strip range-related parameters if they exist in the URL
      let downloadUrl = url;
      try {
        const urlObj = new URL(url);
        // Common parameters used for range/offset that might limit size
        const rangeParams = ['range', 'offset', 'start', 'end'];
        let changed = false;
        rangeParams.forEach(param => {
          if (urlObj.searchParams.has(param)) {
            urlObj.searchParams.delete(param);
            changed = true;
          }
        });
        if (changed) downloadUrl = urlObj.toString();
      } catch (e) {}

      const id = await browser.downloads.download({
        url: downloadUrl,
        filename: newName,
        saveAs: false // Already showed our own dialog
      });
      mediaDiv.dataset.downloadId = id;
      // UI cleanup will be handled by background progress listener
    } else {
      // Send message to background to start download
      browser.runtime.sendMessage({
        action: 'startFetchDownload',
        url: url,
        downloadId: mediaDiv.dataset.downloadId,
        filename: newName,
        request: targetRequest
      });
      // UI updates will be handled by the message listener
    }  } catch (error) {
    showDialog("Download error: " + error.message);
    finishDownloadUI(url);
  } finally {
    if (wakeLock) wakeLock.release();
  }
}

async function generateTemplateName(template, url, originalName) {
    let result = template || "{name}";
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    const pageTitle = activeTab ? activeTab.title : "Media";
    const host = new URL(url).hostname;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    // Extract name without extension for {name}
    const lastDotIdx = originalName.lastIndexOf('.');
    const nameWithoutExt = lastDotIdx !== -1 ? originalName.substring(0, lastDotIdx) : originalName;
    const ext = lastDotIdx !== -1 ? originalName.substring(lastDotIdx) : '';

    result = result
        .replace(/{title}/g, pageTitle)
        .replace(/{host}/g, host)
        .replace(/{date}/g, dateStr)
        .replace(/{time}/g, timeStr)
        .replace(/{name}/g, nameWithoutExt);
    
    // Ensure extension is kept if not in template and not already present
    if (ext && !result.toLowerCase().endsWith(ext.toLowerCase())) {
        result += ext;
    }

    // Basic filename sanitization
    return result.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function showRenameDialog(initialValue) {
    return new Promise((resolve) => {
        const dialog = document.createElement('mdui-dialog');
        dialog.headline = browser.i18n.getMessage("renameDialogHeadline") || "Download as...";
        
        const textField = document.createElement('mdui-text-field');
        textField.value = initialValue;
        textField.style.marginTop = '16px';
        textField.setAttribute('label', browser.i18n.getMessage("renameDialogLabel") || "Filename");
        dialog.appendChild(textField);

        const cancelBtn = document.createElement('mdui-button');
        cancelBtn.slot = "action";
        cancelBtn.variant = "text";
        cancelBtn.textContent = browser.i18n.getMessage("renameDialogCancelButton") || "Cancel";
        cancelBtn.addEventListener('click', () => {
            dialog.open = false;
            resolve(null);
        });

        const okBtn = document.createElement('mdui-button');
        okBtn.slot = "action";
        okBtn.variant = "tonal";
        okBtn.textContent = browser.i18n.getMessage("renameDialogDownloadButton") || "Download";
        okBtn.addEventListener('click', () => {
            dialog.open = false;
            resolve(textField.value);
        });

        dialog.appendChild(cancelBtn);
        dialog.appendChild(okBtn);
        document.body.appendChild(dialog);
        
        dialog.open = true;
        
        dialog.addEventListener('closed', () => {
            dialog.remove();
        });
    });
}


const beforeUnloadHandler = (event) => { event.preventDefault(); };
