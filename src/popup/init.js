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



function applyHeaderAndBottomBarDesign(headerDesign, barDesign) {
  const htmlEl = document.documentElement;
  htmlEl.classList.remove('top-header-v1', 'top-header-v2', 'bottom-bar-v1', 'bottom-bar-v2', 'bottom-bar-v3');
  const hDesign = headerDesign || 'v1';
  const bDesign = barDesign || 'v3';
  htmlEl.classList.add(hDesign === 'v1' ? 'top-header-v1' : 'top-header-v2');
  htmlEl.classList.add(bDesign === 'v1' ? 'bottom-bar-v1' : bDesign === 'v3' ? 'bottom-bar-v3' : 'bottom-bar-v2');
}

async function initTheme() {
  const result = await browser.storage.local.get(['theme-color', 'theme-mode']);
  const themeColor = result['theme-color'] || '#bbdefb';
  const themeMode = result['theme-mode'] || 'auto';

  if (typeof mdui !== 'undefined' && mdui.setColorScheme) {
    mdui.setColorScheme(themeColor);
  }

  const htmlEl = document.documentElement;
  htmlEl.classList.remove('mdui-theme-auto', 'mdui-theme-light', 'mdui-theme-dark', 'theme-pitch-black');

  if (themeMode === 'auto') {
    htmlEl.classList.add('mdui-theme-auto');
  } else if (themeMode === 'light') {
    htmlEl.classList.add('mdui-theme-light');
  } else if (themeMode === 'dark') {
    htmlEl.classList.add('mdui-theme-dark');
  } else if (themeMode === 'pitch-black') {
    htmlEl.classList.add('mdui-theme-dark');
    htmlEl.classList.add('theme-pitch-black');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  checkForUpdates();
  checkAndShowEventPopup();
  await initTheme();
  const designSettings = await browser.storage.local.get(['top-header-design', 'bottom-bar-design']);
  applyHeaderAndBottomBarDesign(designSettings['top-header-design'], designSettings['bottom-bar-design']);


  const scaleResult = await browser.storage.local.get('ui-scale');
  document.documentElement.style.zoom = scaleResult['ui-scale'] || '85%';

  const historyPageResult = await browser.storage.local.get('history-page');
  if (historyPageResult['history-page'] === '1') {
    document.getElementById('history-tab').style.display = 'inline-flex';
    const navbar = document.getElementById('navbar');
    if (navbar) {
      setTimeout(() => {
        if (typeof navbar.requestUpdate === 'function') navbar.requestUpdate();
        window.dispatchEvent(new Event('resize'));
        const currentVal = navbar.value;
        navbar.value = '';
        navbar.value = currentVal;
      }, 100);
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const savedTab = sessionStorage.getItem('activeTab');
  const initialTab = urlParams.get('options') === 'true'
    ? 'settings'
    : (urlParams.get('tab') === 'history' ? 'history' : (savedTab || 'home'));
  document.getElementById('navbar').value = initialTab;
  currentNavigationTab = initialTab;

  const globalLoading = document.getElementById('loading');
  const mainContent = document.getElementById('main-content');
  if (globalLoading) globalLoading.style.display = 'none';
  if (mainContent) mainContent.style.display = 'block';
  if (initialTab === 'home') {
    const mediaLoading = document.getElementById('loading-media-list');
    if (mediaLoading) mediaLoading.style.display = 'block';
  }
  activateNavigationTab(initialTab)
    .then(() => {
      restoreNavigationScroll(initialTab);
      warmNavigationTabs(initialTab);
    })
    .catch(error => console.error(`Failed to load ${initialTab} tab:`, error));

  let searchDebounceTimer = null;
  document.getElementById('search-bar').addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => filterAndRenderMediaList(e.target.value), 200);
  });

  document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const activeRequests = getActiveRequests();
    if (isChecked) {
      activeRequests.forEach(item => {
        selectedUrls.add(item.bestRequest.originalUrl);
      });
    } else {
      activeRequests.forEach(item => {
        selectedUrls.delete(item.bestRequest.originalUrl);
      });
    }
    const items = document.querySelectorAll('.media-item');
    items.forEach(item => {
      const cb = item.querySelector('.media-checkbox');
      if (cb) cb.checked = isChecked;
    });
    updateSelectedCount();
  });

  async function triggerBatchDownload(requests) {
    if (!requests || requests.length === 0) return;
    const hasYouTube = requests.some(req => isYoutubeVideoItem(req));

    if (!hasYouTube && requests.length > 1) {
      await downloadAllAsZip(requests);
      return;
    }

    let startedCount = 0;
    for (const req of requests) {
      const url = req?.bestRequest?.originalUrl || req?.bestRequest?.url;
      if (!url) continue;

      const itemElement = Array.from(document.querySelectorAll('.media-item')).find(el => el.dataset.url === url || (el.dataset.originalUrl && el.dataset.originalUrl === url));
      const dlBtn = itemElement?.querySelector('#download-button');
      if (itemElement && itemElement.querySelector('mdui-linear-progress')) {
        continue; // Already downloading
      }

      if (dlBtn && !dlBtn.classList.contains('is-paused') && !dlBtn.classList.contains('is-playing')) {
        dlBtn.click();
        startedCount++;
      } else {
        await downloadFile(url, itemElement, req?.bestRequest?.size, true);
        startedCount++;
      }
      await new Promise(r => setTimeout(r, 150));
    }

    if (startedCount > 0 && typeof mdui !== 'undefined' && mdui.snackbar) {
      tampilnoNotif(browser.i18n.getMessage('downloadStartedSnackbar') || browser.i18n.getMessage('downloadStarted') || 'Download started...');
    }
  }

  document.getElementById('download-selected').addEventListener('click', async () => {
    const activeRequests = getActiveRequests();
    const selectedActiveRequests = activeRequests.filter(req => selectedUrls.has(req.bestRequest.originalUrl));
    if (selectedActiveRequests.length === 0) return;
    await triggerBatchDownload(selectedActiveRequests);
  });

  document.getElementById('download-all').addEventListener('click', async () => {
    const activeRequests = getActiveRequests();
    if (activeRequests.length === 0) return;
    await triggerBatchDownload(activeRequests);
  });

  document.getElementById('delete-selected').addEventListener('click', async () => {
    const activeRequests = getActiveRequests();
    const selectedActiveRequests = activeRequests.filter(req => selectedUrls.has(req.bestRequest.originalUrl));
    if (selectedActiveRequests.length === 0) return;

    await mdui.confirm({
      headline: browser.i18n.getMessage("deleteAllConfirmTitle") || "Confirm Deletion",
      description: browser.i18n.getMessage("deleteAllConfirm") || "Are you sure you want to delete all selected media?",
      confirmText: browser.i18n.getMessage("deleteSelectedButton") || "Delete",
      cancelText: browser.i18n.getMessage("cancelButton") || "Cancel",
      onConfirm: async () => {
        let jumlahDibusak = 0;
        for (const item of selectedActiveRequests) {
          const url = item.bestRequest.originalUrl;
          browser.runtime.sendMessage({ action: 'removeMedia', url: url });
          selectedUrls.delete(url);
          allMediaRequests = allMediaRequests.filter(x => x.bestRequest.originalUrl !== url);
          allFilteredRequests = allFilteredRequests.filter(x => x.bestRequest.originalUrl !== url);

          const itemElement = Array.from(document.querySelectorAll('.media-item')).find(el => el.dataset.url === url);
          if (itemElement) { itemElement.remove(); jumlahDibusak++; }
        }

        updateSelectedCount();

        const mediaContainer = document.getElementById('media-list');
        if (mediaContainer && mediaContainer.querySelectorAll('.media-item').length === 0) {
          renderInitialList();
        } else if (jumlahDibusak > 0) {
          kurangiRenderedCount(jumlahDibusak);
        }
      }
    });
  });

  document.getElementById('cancel-selected').addEventListener('click', () => {
    const activeRequests = getActiveRequests();
    const selectedActiveRequests = activeRequests.filter(req => selectedUrls.has(req.bestRequest.originalUrl));
    selectedActiveRequests.forEach(item => {
      const url = item.bestRequest.originalUrl;
      const itemElement = Array.from(document.querySelectorAll('.media-item')).find(el => el.dataset.url === url);
      if (itemElement && itemElement.querySelector('mdui-linear-progress')) {
        const dlId = itemElement.dataset.downloadId;
        browser.runtime.sendMessage({ action: 'cancelDownload', url: url, id: dlId });
        finishDownloadUI(dlId || url, false);
      }
    });
  });

  document.getElementById('cancel-all').addEventListener('click', () => {
    const sudahDibatalkan = new Set();
    const activeItems = document.querySelectorAll('.media-item mdui-linear-progress');
    activeItems.forEach(progress => {
      const itemElement = progress.closest('.media-item'); if (!itemElement) return;
      const url = itemElement.dataset.url;
      const dlId = itemElement.dataset.downloadId;
      if (dlId) sudahDibatalkan.add(String(dlId));
      if (url) sudahDibatalkan.add(url);
      browser.runtime.sendMessage({ action: 'cancelDownload', url: url, id: dlId });
      finishDownloadUI(dlId || url, false);
    });
    getActiveDownloadSnapshot().then(snapshot => {
      if (!snapshot) return;
      const dibatalkanSnapshot = new Set();
      for (const id of Object.keys(snapshot)) {
        if (sudahDibatalkan.has(String(id))) continue;
        const entri = snapshot[id];
        if (entri?.url && sudahDibatalkan.has(entri.url)) continue;
        dibatalkanSnapshot.add(String(id));
        browser.runtime.sendMessage({ action: 'cancelDownload', url: entri?.url, id });
        finishDownloadUI(id, false);
      }
      let sisa = 0;
      for (const [sid, entri] of Object.entries(snapshot)) {
        if (dibatalkanSnapshot.has(String(sid))) continue;
        if (sudahDibatalkan.has(String(sid))) continue;
        if (entri?.url && sudahDibatalkan.has(entri.url)) continue;
        if (entri?.isZip || entri?.isCachedSave) continue;
        if (entriUnduhanSelesai(entri)) continue;
        sisa++;
      }
      downloadingCount = sisa;
      updateDownloadingCount(0);
    }).catch(() => {});
  });

  document.getElementById('navbar').addEventListener('change', (event) => {

    const navbar = document.getElementById('navbar');
    if (event.target !== navbar && event.target.tagName !== 'MDUI-TAB') return;
    const selectedTab = navbar.value;
    if (!selectedTab || selectedTab === currentNavigationTab) return;
    saveNavigationScroll(currentNavigationTab);
    currentNavigationTab = selectedTab;
    sessionStorage.setItem('activeTab', selectedTab);
    activateNavigationTab(selectedTab)
      .then(() => restoreNavigationScroll(selectedTab))
      .catch(error => console.error(`Failed to load ${selectedTab} tab:`, error));
  });

  window.addEventListener('pagehide', () => saveNavigationScroll());

  let sessionChangeReloadTimer = null;
  function jadwalRefreshListMedia() {
    clearTimeout(sessionChangeReloadTimer);
    sessionChangeReloadTimer = setTimeout(() => { loadMediaList().catch(() => {}); }, 600);
  }
  let refreshSelektifTimer = null;
  function jadwalRefreshSelektif() {
    clearTimeout(refreshSelektifTimer);
    refreshSelektifTimer = setTimeout(() => { refreshListMediaSelektif().catch(() => {}); }, 600);
  }
  if (browser.tabs?.onActivated) {
    browser.tabs.onActivated.addListener(() => {
      if (document.getElementById('navbar')?.value === 'home' && document.visibilityState === 'visible') jadwalRefreshListMedia();
    });
  }
  if (browser.tabs?.onUpdated) {
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && document.getElementById('navbar')?.value === 'home' && document.visibilityState === 'visible') jadwalRefreshListMedia();
    });
  }

  browser.storage.onChanged.addListener(async (changes, area) => {
    const activeNavigationTab = document.getElementById('navbar')?.value;
    if (area === 'session') {
      if (activeNavigationTab !== 'home') {
        navigationPageLoads.delete('home');
        return;
      }
      if (document.visibilityState !== 'visible') { navigationPageLoads.delete('home'); return; }
      jadwalRefreshSelektif();
      return;
    }
    if (area !== 'local') return;

    if (Object.prototype.hasOwnProperty.call(changes, 'download-history')) {
      navigationPageLoads.delete('history');
      muatKunciMediaSudahDiunduh(changes['download-history'].newValue || []);
    }

    const mediaFilterSettings = [
      'manual-scan', 'manual-scan-keep-tabs', 'only-video', 'only-audio', 'only-stream', 'only-image',
      'only-subtitle', 'only-file', 'ignore-disabled-types', 'hide-segments', 'disable-deduplication',
      'min-file-size', 'min-file-size-custom', 'image-min-side', 'image-min-side-custom', 'image-min-file-size', 'image-min-file-size-custom', 'hide-image-without-size'
    ];

    if (mediaFilterSettings.some(s => Object.prototype.hasOwnProperty.call(changes, s))) {
      if (activeNavigationTab === 'home') {
        loadMediaList();
      } else {
        navigationPageLoads.delete('home');
      }
    }

    if (changes['history-page']) {
      const historyTab = document.getElementById('history-tab');
      const navbar = document.getElementById('navbar');
      if (changes['history-page'].newValue === '1') {
        if (historyTab) historyTab.style.display = 'inline-flex';
      } else {
        if (historyTab) historyTab.style.display = 'none';
        if (navbar?.value === 'history') {
          saveNavigationScroll('history');
          currentNavigationTab = 'home';
          navbar.value = 'home';
          sessionStorage.setItem('activeTab', 'home');
          activateNavigationTab('home').catch(error => console.error('Failed to load home tab:', error));
        }
      }
      refreshNavbarLayout(navbar);
    }

        if (changes['top-header-design'] || changes['bottom-bar-design']) {
      const res = await browser.storage.local.get(['top-header-design', 'bottom-bar-design']);
      applyHeaderAndBottomBarDesign(res['top-header-design'], res['bottom-bar-design']);
      loadMediaList().catch(() => {});
    }

    if (changes['theme-color'] || changes['theme-mode']) {
      initTheme();
    }

    if (changes['ui-scale']) {
      document.documentElement.style.zoom = changes['ui-scale'].newValue || '85%';
    }

    if (changes['group-download-progress']) {
      const enabled = changes['group-download-progress'].newValue === '1' || changes['group-download-progress'].newValue === true;
      isGroupProgressEnabled = enabled;
      updateGlobalProgressVisibility();
      if (!enabled) {
        document.querySelectorAll('.group-progress-wrapper').forEach(el => el.remove());
      } else {
        document.querySelectorAll('.media-group-card[data-group-type]').forEach(card => {
          syncGroupProgressCard(card.dataset.groupType);
        });
      }
    }
  });

  const appNavMenu = document.getElementById('app-nav-menu');
  const appNavToggle = document.getElementById('app-nav-toggle');
  const closeAppNav = () => {
    if (appNavMenu?.classList.contains('open')) {
      appNavMenu.classList.remove('open');
      appNavToggle?.setAttribute('aria-expanded', 'false');
    }
  };
  const syncAppNavItems = () => {
    const current = document.getElementById('navbar')?.value;
    const historyVisible = document.getElementById('history-tab')?.style.display !== 'none';
    document.querySelectorAll('#app-nav-list .app-nav-item').forEach(item => {
      const tab = item.dataset.navTab;
      item.style.display = (tab === 'history' && !historyVisible) ? 'none' : '';
      item.setAttribute('variant', tab === current ? 'filled' : 'tonal');
    });
  };
  appNavToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    syncAppNavItems();
    const isOpen = appNavMenu.classList.toggle('open');
    appNavToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
  document.querySelectorAll('#app-nav-list .app-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const navbar = document.getElementById('navbar');
      const tab = item.dataset.navTab;
      closeAppNav();
      if (!navbar || !tab || navbar.value === tab) return;
      navbar.value = tab;
      navbar.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  document.addEventListener('click', (e) => {
    if (appNavMenu?.classList.contains('open') && !appNavMenu.contains(e.target)) closeAppNav();
  });

  const speedDialContainer = document.getElementById('bottom-speed-dial');
  const speedDialToggle = document.getElementById('speed-dial-toggle');
  const closeSpeedDial = () => {
    if (speedDialContainer?.classList.contains('open')) {
      speedDialContainer.classList.remove('open');
      speedDialToggle?.setAttribute('aria-expanded', 'false');
    }
  };
  speedDialToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = speedDialContainer.classList.toggle('open');
    speedDialToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
  document.addEventListener('click', (e) => {
    if (speedDialContainer?.classList.contains('open') && !speedDialContainer.contains(e.target)) {
      closeSpeedDial();
    }
  });

  document.getElementById('refresh-list').addEventListener('click', () => {
    closeSpeedDial();
    loadMediaList();
  });
  document.getElementById('clear-list').addEventListener('click', () => {
    closeSpeedDial();
    clearMediaList();
  });

  const handleManualScanClick = async (scanBtn) => {
    if (!scanBtn) return;
    scanBtn.loading = true;
    scanBtn.disabled = true;
    try {
      const activeTab = await getTargetMediaTab();
      await browser.runtime.sendMessage({ action: 'performManualScan', tabId: activeTab?.id, pageUrl: activeTab?.url || '' }).catch(() => {});
      if (activeTab?.id !== undefined) {
        await browser.tabs.sendMessage(activeTab.id, { action: 'manualScanTab' }).catch(() => {});
      }
      await new Promise(resolve => setTimeout(resolve, 350));
      await browser.runtime.sendMessage({ action: 'performManualScan', tabId: activeTab?.id, pageUrl: activeTab?.url || '' }).catch(() => {});
      await loadMediaList();
    } finally {
      if (scanBtn.isConnected) {
        scanBtn.loading = false;
        scanBtn.disabled = false;
      }
      closeSpeedDial();
    }
  };

  const handleAddManualUrlClick = async () => {
    closeSpeedDial();
    const url = await showAddManualUrlDialog();
    if (url) {
      addManualUrl(url);
    }
  };

  document.getElementById('manual-scan-btn-bottom')?.addEventListener('click', (e) => handleManualScanClick(e.currentTarget));
  document.getElementById('add-manual-url-btn-bottom')?.addEventListener('click', () => handleAddManualUrlClick());

  document.getElementById('media-list').addEventListener('click', async (e) => {
    const scanBtn = e.target.closest('#manual-scan-btn-empty');
    if (scanBtn) {
      await handleManualScanClick(scanBtn);
      return;
    }
    const btn = e.target.closest('#add-manual-url-btn-empty');
    if (btn) {
      await handleAddManualUrlClick();
    }
  });

  document.getElementById('help-button').addEventListener('click', async () => {
    const CHANGELOG_REMOTE_URL = 'https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1/src/changelog.json';
    const CHANGELOG_LOCAL_URL = browser.runtime.getURL('changelog.json');

    try {
      let response;
      try {
        response = await fetch(CHANGELOG_REMOTE_URL + '?t=' + Date.now());
        if (!response.ok) throw new Error('Remote fetch failed');
      } catch (remoteError) {
        console.warn("Failed to fetch remote changelog, using local fallback:", remoteError);
        response = await fetch(CHANGELOG_LOCAL_URL);
      }

      const data = await response.json();
      const lang = browser.i18n.getUILanguage().split('-')[0];
      const content = data[lang] || data['en'];
      let version = browser.runtime.getManifest().version;
      try {
        const aboutRes = await fetch(browser.runtime.getURL('about.json?t=' + Date.now()));
        if (aboutRes.ok) {
          const aboutData = await aboutRes.json();
          version = aboutData?.extension?.version || version;
        }
      } catch (e) {}

      const headlineHtml = `
        <div style="display: flex; align-items: baseline; justify-content: space-between; width: 100%;">
          <span>${escapeHtmlPopup(content.headline || '')}</span>
          <span style="opacity: 0.5; font-size: 0.8rem; font-weight: normal; margin-left: 16px;">v${version}</span>
        </div>`;

      const changelogHtml = `<ul style="padding-left: 20px; margin: 0;">${(content.changes || []).map(change => `<li>${escapeHtmlPopup(change)}</li>`).join('')}</ul>`;

      const githubButton = document.createElement('mdui-button');
      githubButton.variant = "text";
      githubButton.href = "https://github.com/anpa26/website-media-downloader";
      githubButton.target = "_blank";
      githubButton.style.marginRight = "auto";
      githubButton.style.marginLeft = "-8px";
      githubButton.innerHTML = `
        <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> ${browser.i18n.getMessage("githubRepositoryLabel") || "GitHub Repository"}
      `;

      showDialog(changelogHtml, headlineHtml, [githubButton], true);
    } catch (e) {
      console.error("Failed to load changelog:", e);
      const githubButton = document.createElement('mdui-button');
      githubButton.variant = "text";
      githubButton.href = "https://github.com/anpa26/website-media-downloader";
      githubButton.target = "_blank";
      githubButton.style.marginRight = "auto";
      githubButton.style.marginLeft = "-8px";
      githubButton.innerHTML = `
        <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> ${browser.i18n.getMessage("githubRepositoryLabel") || "GitHub Repository"}
      `;
      showDialog(browser.i18n.getMessage("aboutChangelogDescription"), browser.i18n.getMessage("aboutChangelogTitle"), [githubButton]);
    }
  });

  const mode = urlParams.get('mode');
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || isIPadOS;
  if (isMobile) {
    document.documentElement.classList.add('is-mobile');
    document.body.classList.add('is-mobile');
  }
  if (urlParams.get('options') === 'true' || mode === 'tab' || mode === 'window') {
    document.documentElement.classList.add('is-tab');
    document.body.classList.add('is-tab');
  } else {
    document.documentElement.classList.add('is-popup');
    document.body.classList.add('is-popup');
  }

  if (urlParams.get('options') === 'true') {
    document.getElementById('navbar').value = 'settings';
  } else {
    if (urlParams.get('tab') === 'history') {
      document.getElementById('navbar').value = 'history';
    }
  }
});
