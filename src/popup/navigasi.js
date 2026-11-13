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



const navigationPageLoads = new Map();
const navigationSkeletonsShown = new Set();
function showNavigationSkeleton(tab) {
  if (navigationSkeletonsShown.has(tab)) return;
  const target = tab === 'home'
    ? document.getElementById('media-list')
    : tab === 'history'
      ? document.getElementById('history-list')
      : tab === 'about'
        ? document.getElementById('about-container')
        : document.getElementById('settings-container');
  if (!target) return;
  navigationSkeletonsShown.add(tab);
  target.classList.add('tab-content-loading');
  const skeleton = document.createElement('div');
  skeleton.className = 'tab-skeleton';
  skeleton.innerHTML = '<div class="tab-skeleton-card"></div>'.repeat(tab === 'settings' ? 5 : 4);
  target.prepend(skeleton);
}

function hideNavigationSkeleton(tab) {
  const target = tab === 'home'
    ? document.getElementById('media-list')
    : tab === 'history'
      ? document.getElementById('history-list')
      : tab === 'about'
        ? document.getElementById('about-container')
        : document.getElementById('settings-container');
  if (!target) return;
  target.querySelector(':scope > .tab-skeleton')?.remove();
  target.classList.remove('tab-content-loading');
}

function loadNavigationPageOnce(tab, loader) {
  if (navigationPageLoads.has(tab)) return navigationPageLoads.get(tab);
  showNavigationSkeleton(tab);
  const loadPromise = Promise.resolve()
    .then(loader)
    .catch(error => {
      navigationPageLoads.delete(tab);
      throw error;
    })
    .finally(() => hideNavigationSkeleton(tab));
  navigationPageLoads.set(tab, loadPromise);
  return loadPromise;
}

function refreshNavbarLayout(navbar) {
  if (!navbar) return;
  requestAnimationFrame(() => {
    if (typeof navbar.requestUpdate === 'function') navbar.requestUpdate();
    window.dispatchEvent(new Event('resize'));
    const currentValue = navbar.value;
    navbar.value = '';
    requestAnimationFrame(() => { navbar.value = currentValue; });
  });
}
let currentNavigationTab = 'home';
function saveNavigationScroll(tab = currentNavigationTab) {
  if (tab) sessionStorage.setItem(`scrollPos:${tab}`, String(window.scrollY || 0));
}
function restoreNavigationScroll(tab) {
  const target = parseInt(sessionStorage.getItem(`scrollPos:${tab}`) || '0', 10);
  let attempts = 0;
  const restore = () => {
    if (currentNavigationTab !== tab) return;
    window.scrollTo(0, target);
    if (window.scrollY < target && attempts++ < 8) setTimeout(restore, 50);
  };
  requestAnimationFrame(restore);
}
let historyPageInitialized = false;
function initializeHistoryPage() {
  if (historyPageInitialized) return;
  historyPageInitialized = true;
  document.getElementById('clear-history').addEventListener('click', () => clearHistory());
  document.getElementById('export-history').addEventListener('click', () => exportHistory());
  document.getElementById('import-history').addEventListener('click', () => {
    document.getElementById('import-history-input').click();
  });
  document.getElementById('import-history-input').addEventListener('change', handleImportHistory);
}
async function activateNavigationTab(tab) {
  if (tab === 'settings') {
    return loadNavigationPageOnce(tab, async () => {
      await ensureScriptLoaded('entries/settings.js', 'initializeSettingsPage');
      await window.initializeSettingsPage();
    });
  }
  if (tab === 'about') {
    return loadNavigationPageOnce(tab, loadAboutPage);
  }
  if (tab === 'history') {
    initializeHistoryPage();
    return loadNavigationPageOnce(tab, loadHistoryList);
  }
  if (tab === 'home') {
    if (!navigationPageLoads.has(tab)) activeGroup = null;
    return loadNavigationPageOnce(tab, loadMediaList);
  }
}

function waitForNavigationIdle() {
  return new Promise(resolve => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: 750 });
    } else {
      setTimeout(resolve, 75);
    }
  });
}

async function warmNavigationTabs(initialTab) {
  const warmOrder = ['history', 'about', 'settings', 'home'];
  for (const tab of warmOrder) {
    if (tab === initialTab || navigationPageLoads.has(tab)) continue;
    await waitForNavigationIdle();
    try {
      await activateNavigationTab(tab);
    } catch (error) {
      console.warn(`Failed to warm ${tab} tab:`, error);
    }
  }
}
