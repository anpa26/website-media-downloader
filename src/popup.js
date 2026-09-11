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

if (typeof browser === 'undefined') {
  var browser = chrome;
}

async function ensureScriptLoaded(src, globalVarName) {
  if (typeof window[globalVarName] !== 'undefined') return;
  if (document.querySelector(`script[src="${src}"]`)) {
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (typeof window[globalVarName] !== 'undefined') {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
    return;
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = browser.runtime.getURL(src);
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(s);
  });
}

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
      await ensureScriptLoaded('settings.js', 'initializeSettingsPage');
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

function isFlagEnabled(val, defaultVal = false) {
  if (val === undefined) return defaultVal;
  return val === '1' || val === 1 || val === true || val === 'true';
}

if (!browser.storage.session) {
  browser.storage.session = {
      get: (keys, cb) => browser.storage.local.get(keys, cb),
      set: (obj, cb) => browser.storage.local.set(obj, cb),
      remove: (keys, cb) => browser.storage.local.remove(keys, cb),
      clear: (cb) => browser.storage.local.clear(cb)
  };
}

let downloadingCount = 0;
let allMediaRequests = [];
let allFilteredRequests = [];
let renderedCount = 0;
const CHUNK_SIZE = 20;
let intersectionObserver = null;
let isRenderingChunk = false;
const renderedMediaUrls = new Set();
const mediaPreviewLoadObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.loadMediaPreview?.();
    mediaPreviewLoadObserver.unobserve(entry.target);
  });
}, { rootMargin: '400px 0px' });
const uiCache = new Map();
let isGroupingEnabled = false;
let activeGroup = null;
let activeDownloadingElements = [];
const selectedUrls = new Set();

function getActiveRequests() {
  return (isGroupingEnabled && activeGroup !== null)
    ? allFilteredRequests.filter(item => item.type === activeGroup)
    : allFilteredRequests;
}

async function spoofedFetch(url, options = {}) {
  try {
    const headers = await browser.runtime.sendMessage({ action: 'getSpoofedHeaders', url: url });
    options.headers = options.headers || {};
    if (url.includes('googlevideo.com') || url.includes('youtube.com')) {
      options.headers['Referer'] = 'https://www.youtube.com/';
      options.referrer = 'https://www.youtube.com/';
      options.headers['Origin'] = 'https://www.youtube.com';
    }
    if (headers) {
      if (headers.cookie) options.headers['Cookie'] = headers.cookie;
      if (headers.referer) {
        options.headers['Referer'] = headers.referer;
        options.referrer = headers.referer;
      }
      if (headers.origin) options.headers['Origin'] = headers.origin;
      options.credentials = 'include';
    }
  } catch (e) {
    console.warn("Failed to get spoofed headers, falling back to normal fetch:", e);
    if (url.includes('googlevideo.com') || url.includes('youtube.com')) {
      options.headers = options.headers || {};
      options.headers['Referer'] = 'https://www.youtube.com/';
      options.referrer = 'https://www.youtube.com/';
      options.headers['Origin'] = 'https://www.youtube.com';
    }
  }
  return fetch(url, options);
}

window.activeCancellations = new Set();
window.activeCancellations.restoreCallbacks = new Map();
window.activeCancellations.setRestoreCallback = (url, cb) => {
  window.activeCancellations.restoreCallbacks.set(url, cb);
};
window.activePauses = new Set();
window.activeAbortControllers = new Map();

async function checkForUpdates() {
  const settings = await browser.storage.local.get('auto-check-update');
  if (settings['auto-check-update'] === '0') {
    return;
  }
  const AMO_URL = 'https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader';
  const CHANGELOG_URL = 'https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1/src/changelog.json';

  let nativeUpdateFound = false;
  let requireUninstall = false;
  let reinstallDescription = '';
  try {
    const changelogRes = await fetch(CHANGELOG_URL + '?t=' + Date.now());
    if (changelogRes.ok) {
      const changelogData = await changelogRes.json();
      requireUninstall = !!changelogData.require_uninstall;
      const lang = browser.i18n.getUILanguage().split('-')[0];
      reinstallDescription = (changelogData[lang] || changelogData.en)?.reinstall_description || '';
    }
  } catch (e) {
    console.warn('Failed to fetch remote changelog:', e);
  }

  if (browser.runtime.requestUpdateCheck) {
    try {
      const result = await browser.runtime.requestUpdateCheck();
      if (result && result.status === 'update_available') {
        showUpdateNotification(AMO_URL, result.version || 'new', requireUninstall, reinstallDescription);
        nativeUpdateFound = true;
      }
    } catch (err) {
      console.warn('Native update check failed, trying custom fallback:', err);
    }
  }

  if (!nativeUpdateFound) {
    try {
      const result = await performUpdateCheck();
      if (result.updateAvailable) {
        showUpdateNotification(result.updateUrl, result.latestVersion, requireUninstall || result.requireUninstall, reinstallDescription);
      }
    } catch (error) {
      console.error('Update check failed:', error);
    }
  }
}

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

async function getSpecificReleaseUrl(version) {
  const RELEASES_API_URL = 'https://api.github.com/repos/anpa26/website-media-downloader/releases';
  try {
    const res = await fetch(RELEASES_API_URL + '?per_page=20&t=' + Date.now());
    if (!res.ok) return null;
    const releases = await res.json();
    const tag = 'v' + version;
    // Prefer Latest (non-prerelease) first, then Pre-release
    const latest = releases.find(r => r.tag_name === tag && !r.prerelease && !r.draft);
    if (latest) return latest.html_url;
    const prerelease = releases.find(r => r.tag_name === tag && r.prerelease && !r.draft);
    if (prerelease) return prerelease.html_url;
  } catch (e) {
    console.warn('Failed to fetch specific release URL:', e);
  }
  return null;
}

async function performUpdateCheck() {
  const MANIFEST_URL = 'https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1/src/manifest.json';
  const AMO_URL = 'https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader';
  const AMO_API_URL = 'https://addons.mozilla.org/api/v5/addons/addon/website-media-downloader/';

  const currentVersion = browser.runtime.getManifest().version;
  const isFirefox = navigator.userAgent.includes('Firefox') || (typeof browser !== 'undefined' && browser.runtime.getURL && browser.runtime.getURL('').startsWith('moz-extension://'));

  if (isFirefox) {
    let githubVersion = null;
    let amoVersion = null;

    try {
      const [githubRes, amoRes] = await Promise.all([
        fetch(MANIFEST_URL + '?t=' + Date.now()).then(r => r.ok ? r.json() : null),
        fetch(AMO_API_URL + '?t=' + Date.now()).then(r => r.ok ? r.json() : null)
      ]);

      if (githubRes) githubVersion = githubRes.version;
      if (amoRes && amoRes.current_version) amoVersion = amoRes.current_version.version;
    } catch (e) {
      console.warn("Parallel fetch failed, trying fallbacks:", e);
    }

    if (!githubVersion) {
      try {
        const res = await fetch(MANIFEST_URL + '?t=' + Date.now());
        if (res.ok) {
          const data = await res.json();
          githubVersion = data.version;
        }
      } catch (e) {
        console.error("Fallback GitHub fetch failed:", e);
      }
    }

    if (!githubVersion) {
      throw new Error("Failed to check for updates");
    }

    if (compareVersions(githubVersion, currentVersion) > 0) {
      let requireUninstall = false;
      try {
        const changelogRes = await fetch('https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1/src/changelog.json?t=' + Date.now());
        if (changelogRes.ok) {
          const data = await changelogRes.json();
          requireUninstall = !!data.require_uninstall;
        }
      } catch (e) {}

      if (amoVersion && compareVersions(amoVersion, githubVersion) === 0) {
        return { updateAvailable: true, latestVersion: githubVersion, updateUrl: AMO_URL, requireUninstall };
      } else {
        const specificUrl = await getSpecificReleaseUrl(githubVersion);
        if (specificUrl) {
          return { updateAvailable: true, latestVersion: githubVersion, updateUrl: specificUrl, requireUninstall };
        }
      }
    }
  } else {
    try {
      const response = await fetch(MANIFEST_URL + '?t=' + Date.now());
      if (response.ok) {
        const data = await response.json();
        const githubVersion = data.version;
        if (compareVersions(githubVersion, currentVersion) > 0) {
          let requireUninstall = false;
          try {
            const changelogRes = await fetch('https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1/src/changelog.json?t=' + Date.now());
            if (changelogRes.ok) {
              const data = await changelogRes.json();
              requireUninstall = !!data.require_uninstall;
            }
          } catch (e) {}
          const specificUrl = await getSpecificReleaseUrl(githubVersion);
          if (specificUrl) {
            return { updateAvailable: true, latestVersion: githubVersion, updateUrl: specificUrl, requireUninstall };
          }
        }
      }
    } catch (e) {
      console.error("GitHub fetch failed:", e);
      throw e;
    }
  }

  return { updateAvailable: false, latestVersion: currentVersion, updateUrl: '' };
}

function getUpdateSourceInfo(url) {
  if (url.includes('addons.mozilla.org')) {
    return { label: 'Firefox Add-ons', short: 'addons.mozilla.org' };
  }
  if (url.includes('github.com')) {
    return { label: 'GitHub Releases', short: 'github.com' };
  }
  return { label: url, short: url };
}

function showTopBarUpdateNotification(url, latestVersion) {
  const notification = document.getElementById('update-notification');
  if (!notification) return;

  notification.style.display = 'flex';

  const textSpan = notification.querySelector('[data-translate="updateAvailable"]');
  if (textSpan) {
    textSpan.textContent = browser.i18n.getMessage("updateAvailable", [latestVersion]) || `New version available! (v${latestVersion})`;
  }

  const sourceLabel = document.getElementById('update-source-label');
  if (sourceLabel) {
    const info = getUpdateSourceInfo(url);
    sourceLabel.textContent = info.short;
    sourceLabel.style.display = 'inline';
  }

  const updateLink = document.getElementById('update-link');
  if (updateLink) {
    const newUpdateLink = updateLink.cloneNode(true);
    updateLink.parentNode.replaceChild(newUpdateLink, updateLink);
    newUpdateLink.addEventListener('click', () => {
      browser.tabs.create({ url: url });
    });
  }

  const closeBtn = document.getElementById('close-update-notification');
  if (closeBtn) {
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener('click', () => {
      notification.style.display = 'none';
      sessionStorage.setItem('update-topbar-closed', 'true');
    });
  }
}

function showUpdateDialog(url, latestVersion, requireUninstall = false, reinstallDescription = '') {
  const dialog = document.createElement('mdui-dialog');
  dialog.headline = browser.i18n.getMessage("updateAvailable", [latestVersion]) || `New version available! (v${latestVersion})`;

  const source = getUpdateSourceInfo(url);
  const description = document.createElement('div');
  description.setAttribute('slot', 'description');
  
  let msg = (browser.i18n.getMessage("updateDialogMessage", [latestVersion]) || `Version ${latestVersion} is available. Would you like to update now?`);
  if (requireUninstall) {
    const warningText = `<div style="margin-top: 10px; padding: 10px; background: rgba(var(--mdui-color-error), 0.1); border-left: 4px solid rgb(var(--mdui-color-error)); border-radius: 4px; font-size: 0.8rem; color: rgb(var(--mdui-color-error)); line-height: 1.45;">${reinstallDescription}</div>`;
    msg += warningText;
  }

  description.innerHTML = msg +
    `<div style="margin-top: 10px; display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--on-surface-variant);">
      <span>${browser.i18n.getMessage('updateSourceLabel') || 'Source:'}</span>
      <span style="color: var(--primary); font-weight: 600; background: rgba(var(--mdui-color-primary), 0.1); padding: 1px 8px; border-radius: 99px;">${source.label}</span>
    </div>`;
  dialog.appendChild(description);

  const laterButton = document.createElement('mdui-button');
  laterButton.variant = "text";
  laterButton.textContent = browser.i18n.getMessage("updateLaterButton") || "Later";
  laterButton.slot = 'action';
  laterButton.addEventListener('click', () => {
    dialog.open = false;
    sessionStorage.setItem('update-dismissed', 'true');
    showTopBarUpdateNotification(url, latestVersion);
  });
  dialog.appendChild(laterButton);

  const updateButton = document.createElement('mdui-button');
  updateButton.variant = "tonal";
  updateButton.textContent = browser.i18n.getMessage("updateButton") || "Update";
  updateButton.slot = 'action';
  updateButton.addEventListener('click', () => {
    dialog.open = false;
    browser.tabs.create({ url: url });
  });
  dialog.appendChild(updateButton);

  document.body.appendChild(dialog);
  dialog.open = true;

  dialog.addEventListener('closed', () => {
    dialog.remove();
  });
}

function showUpdateNotification(url, latestVersion, requireUninstall = false, reinstallDescription = '') {
  if (sessionStorage.getItem('update-topbar-closed') === 'true') return;

  if (sessionStorage.getItem('update-dismissed') === 'true') {
    showTopBarUpdateNotification(url, latestVersion);
    return;
  }

  showUpdateDialog(url, latestVersion, requireUninstall, reinstallDescription);
}

async function checkAndShowEventPopup() {
  try {
    const welcomeData = await browser.storage.local.get(['wmd_reinstall_warning_shown', 'wmd_previous_version']);

    let requireUninstall = false;
    try {
      const res = await fetch(browser.runtime.getURL('changelog.json'));
      const changelog = await res.json();
      if (changelog.require_uninstall && welcomeData['wmd_previous_version'] && !welcomeData['wmd_reinstall_warning_shown']) {
        requireUninstall = true;
      }
    } catch (e) {}

    if (requireUninstall) {
      return;
    }

    const rawUrl = 'https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1-event';
    const response = await fetch(`${rawUrl}/info.json?t=` + Date.now());
    if (!response.ok) return;

    const info = await response.json();
    if (!info || info.enabled === false || !info.storage_key) return;

    const storageResult = await browser.storage.local.get(info.storage_key);
    if (storageResult[info.storage_key]) {
      return;
    }

    const dialog = document.createElement('mdui-dialog');
    dialog.closeOnOverlayClick = !info.show_skip ? false : true;
    dialog.closeOnEsc = !info.show_skip ? false : true;

    if (info.title) {
      const headline = document.createElement('div');
      headline.setAttribute('slot', 'headline');
      headline.style.width = '100%';
      headline.style.fontWeight = 'bold';
      headline.textContent = info.title;

      const titlePos = (info.title_position || 'left').toLowerCase();
      if (titlePos === 'center') {
        headline.style.textAlign = 'center';
      } else if (titlePos === 'right') {
        headline.style.textAlign = 'right';
      } else {
        headline.style.textAlign = 'left';
      }
      dialog.appendChild(headline);
    }

    const contentDiv = document.createElement('div');
    contentDiv.setAttribute('slot', 'description');
    contentDiv.style.display = 'flex';
    contentDiv.style.flexDirection = 'column';
    contentDiv.style.gap = '12px';

    let slides = [];
    if (info.slides && Array.isArray(info.slides)) {
      slides = info.slides;
    } else if (info.images && Array.isArray(info.images) && info.images.length > 0) {
      slides = info.images.map(img => ({ image: img, description: info.description }));
    } else if (info.image) {
      slides = [{ image: info.image, description: info.description }];
    } else if (info.description) {
      slides = [{ description: info.description }];
    }

    let descEl = null;

    if (slides.length === 1) {
      const slide = slides[0];
      if (slide.image) {
        const img = document.createElement('img');
        img.src = `${rawUrl}/${slide.image}`;
        img.style.width = '100%';
        img.style.borderRadius = '8px';
        img.style.maxHeight = '240px';
        img.style.objectFit = 'cover';
        contentDiv.appendChild(img);
      }
      if (slide.description) {
        descEl = document.createElement('p');
        descEl.style.margin = '0';
        descEl.style.lineHeight = '1.4';
        descEl.textContent = slide.description;
        contentDiv.appendChild(descEl);
      }
    } else if (slides.length > 1) {
      const hasAnyImage = slides.some(slide => !!slide.image);

      let track = null;
      let currentIndex = 0;
      const totalSlides = slides.length;

      const dotsContainer = document.createElement('div');
      dotsContainer.style.cssText = 'display: flex; justify-content: center; gap: 6px;';

      slides.forEach((_, idx) => {
        const dot = document.createElement('div');
        dot.className = 'carousel-dot';
        dot.style.cssText = 'width: 6px; height: 6px; border-radius: 50%; cursor: pointer; transition: all 0.2s;';
        dot.addEventListener('click', () => {
          currentIndex = idx;
          updateCarousel();
        });
        dotsContainer.appendChild(dot);
      });

      const prevBtn = document.createElement('button');
      prevBtn.innerHTML = '&#10094;';

      const nextBtn = document.createElement('button');
      nextBtn.innerHTML = '&#10095;';

      const setArrowStyleCarousel = (btn, isRight) => {
        btn.style.cssText = `position: absolute; ${isRight ? 'right' : 'left'}: 8px; z-index: 10; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; font-weight: bold; transition: background 0.2s;`;
        btn.onmouseover = () => btn.style.background = 'rgba(0,0,0,0.8)';
        btn.onmouseout = () => btn.style.background = 'rgba(0,0,0,0.5)';
      };

      const setArrowStyleText = (btn) => {
        btn.style.cssText = 'background: none; color: rgb(var(--mdui-color-primary)); border: none; cursor: pointer; font-size: 16px; font-weight: bold; padding: 4px 12px; display: flex; align-items: center; justify-content: center; position: static; width: auto; height: auto;';
        btn.onmouseover = null;
        btn.onmouseout = null;
      };

      let carouselContainer = null;
      if (hasAnyImage) {
        carouselContainer = document.createElement('div');
        carouselContainer.style.position = 'relative';
        carouselContainer.style.width = '100%';
        carouselContainer.style.overflow = 'hidden';
        carouselContainer.style.borderRadius = '8px';
        carouselContainer.style.display = 'flex';
        carouselContainer.style.alignItems = 'center';
        carouselContainer.style.marginBottom = '8px';

        track = document.createElement('div');
        track.style.display = 'flex';
        track.style.width = '100%';
        track.style.transition = 'transform 0.3s ease';

        slides.forEach(slide => {
          const slideContainer = document.createElement('div');
          slideContainer.style.width = '100%';
          slideContainer.style.flexShrink = '0';
          slideContainer.style.maxHeight = '240px';
          slideContainer.style.height = '240px';
          slideContainer.style.display = 'flex';
          slideContainer.style.alignItems = 'center';
          slideContainer.style.justifyContent = 'center';
          slideContainer.style.borderRadius = '8px';
          slideContainer.style.overflow = 'hidden';

          if (slide.image) {
            const img = document.createElement('img');
            img.src = `${rawUrl}/${slide.image}`;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            slideContainer.appendChild(img);
          }
          track.appendChild(slideContainer);
        });
        carouselContainer.appendChild(track);
        contentDiv.appendChild(carouselContainer);
      }

      descEl = document.createElement('p');
      descEl.style.margin = '0';
      descEl.style.lineHeight = '1.4';
      descEl.style.minHeight = '48px';
      contentDiv.appendChild(descEl);

      const navRow = document.createElement('div');
      navRow.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 8px; margin-bottom: 4px; width: 100%;';
      contentDiv.appendChild(navRow);

      const updateCarousel = () => {
        const currentSlide = slides[currentIndex];

        if (currentSlide && currentSlide.image && carouselContainer) {
          carouselContainer.style.display = 'flex';
          navRow.style.display = 'none';

          setArrowStyleCarousel(prevBtn, false);
          setArrowStyleCarousel(nextBtn, true);
          carouselContainer.appendChild(prevBtn);
          carouselContainer.appendChild(nextBtn);

          dotsContainer.style.cssText = 'display: flex; justify-content: center; gap: 6px; margin-top: -4px; margin-bottom: 4px;';
          contentDiv.insertBefore(dotsContainer, descEl);

          if (track) {
            track.style.transform = `translateX(-${currentIndex * 100}%)`;
          }
        } else {
          if (carouselContainer) {
            carouselContainer.style.display = 'none';
          }

          navRow.style.display = 'flex';

          setArrowStyleText(prevBtn);
          setArrowStyleText(nextBtn);
          navRow.appendChild(prevBtn);
          navRow.appendChild(dotsContainer);
          navRow.appendChild(nextBtn);

          dotsContainer.style.cssText = 'display: flex; justify-content: center; gap: 6px;';
        }

        const dots = dotsContainer.querySelectorAll('.carousel-dot');
        dots.forEach((dot, idx) => {
          if (idx === currentIndex) {
            dot.style.background = 'rgb(var(--mdui-color-primary))';
            dot.style.transform = 'scale(1.2)';
          } else {
            dot.style.background = 'rgba(var(--mdui-color-on-surface), 0.3)';
            dot.style.transform = 'scale(1)';
          }
        });

        if (currentSlide && currentSlide.description) {
          descEl.textContent = currentSlide.description;
          descEl.style.display = 'block';
        } else {
          descEl.style.display = 'none';
        }
      };

      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentIndex = (currentIndex - 1 + totalSlides) % totalSlides;
        updateCarousel();
      });

      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentIndex = (currentIndex + 1) % totalSlides;
        updateCarousel();
      });

      updateCarousel();
    }

    dialog.appendChild(contentDiv);

    const actionWrapper = document.createElement('div');
    actionWrapper.setAttribute('slot', 'action');
    actionWrapper.style.display = 'flex';
    actionWrapper.style.width = '100%';
    actionWrapper.style.gap = '8px';

    const pos = (info.button_position || 'right').toLowerCase();

    const actionBtn = document.createElement('mdui-button');
    actionBtn.variant = 'filled';
    actionBtn.textContent = info.button_text || 'OK';
    actionBtn.addEventListener('click', async () => {
      await browser.storage.local.set({ [info.storage_key]: true });
      dialog.open = false;
      if (info.action_url) {
        window.open(info.action_url, '_blank');
      }
    });

    let skipBtn = null;
    if (info.show_skip) {
      skipBtn = document.createElement('mdui-button');
      skipBtn.variant = 'text';
      skipBtn.textContent = browser.i18n.getMessage("cancelButton") || 'Skip';
      skipBtn.addEventListener('click', async () => {
        await browser.storage.local.set({ [info.storage_key]: true });
        dialog.open = false;
      });
    }

    if (pos === 'center') {
      actionWrapper.style.flexDirection = 'column';
      actionWrapper.style.justifyContent = 'center';
      actionWrapper.style.alignItems = 'center';

      actionWrapper.appendChild(actionBtn);
      if (skipBtn) {
        actionWrapper.appendChild(skipBtn);
      }
    } else {
      actionWrapper.style.flexDirection = 'row';
      actionWrapper.style.alignItems = 'center';
      if (pos === 'left') {
        actionWrapper.style.justifyContent = 'flex-start';
      } else {
        actionWrapper.style.justifyContent = 'flex-end';
      }

      actionWrapper.appendChild(actionBtn);
      if (skipBtn) {
        actionWrapper.appendChild(skipBtn);
      }
    }

    dialog.appendChild(actionWrapper);

    document.body.appendChild(dialog);
    dialog.open = true;

    dialog.addEventListener('closed', () => {
      dialog.remove();
    });
  } catch (error) {
    console.error('Error fetching/displaying event popup:', error);
  }
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

  document.getElementById('search-bar').addEventListener('input', (e) => {
    filterAndRenderMediaList(e.target.value);
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

  document.getElementById('download-selected').addEventListener('click', async () => {
    const activeRequests = getActiveRequests();
    const selectedActiveRequests = activeRequests.filter(req => selectedUrls.has(req.bestRequest.originalUrl));
    if (selectedActiveRequests.length === 0) return;

    if (selectedActiveRequests.length > 1) {
      await downloadAllAsZip(selectedActiveRequests);
    } else {
      const item = selectedActiveRequests[0];
      const url = item.bestRequest.originalUrl;
      const itemElement = Array.from(document.querySelectorAll('.media-item')).find(el => el.dataset.url === url);
      await downloadFile(url, itemElement, item.bestRequest.size, true);
    }
  });

  document.getElementById('download-all').addEventListener('click', async () => {
    const activeRequests = getActiveRequests();
    if (activeRequests.length === 0) return;

    if (activeRequests.length > 1) {
      await downloadAllAsZip(activeRequests);
    } else {
      const item = activeRequests[0];
      const url = item.bestRequest.originalUrl;
      const size = item.bestRequest.size;

      const itemElement = Array.from(document.querySelectorAll('.media-item')).find(el => el.dataset.url === url);
      if (itemElement && itemElement.querySelector('mdui-linear-progress')) return;
      await downloadFile(url, itemElement, size, true);
    }
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
        for (const item of selectedActiveRequests) {
          const url = item.bestRequest.originalUrl;
          browser.runtime.sendMessage({ action: 'removeMedia', url: url });
          selectedUrls.delete(url);
          allMediaRequests = allMediaRequests.filter(x => x.bestRequest.originalUrl !== url);
          allFilteredRequests = allFilteredRequests.filter(x => x.bestRequest.originalUrl !== url);

          const itemElement = Array.from(document.querySelectorAll('.media-item')).find(el => el.dataset.url === url);
          if (itemElement) itemElement.remove();
        }

        updateSelectedCount();

        const mediaContainer = document.getElementById('media-list');
        if (mediaContainer && mediaContainer.querySelectorAll('.media-item').length === 0) {
          renderInitialList();
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
    const activeItems = document.querySelectorAll('.media-item mdui-linear-progress');
    activeItems.forEach(progress => {
      const itemElement = progress.closest('.media-item');
      const url = itemElement.dataset.url;
      const dlId = itemElement.dataset.downloadId;
      browser.runtime.sendMessage({ action: 'cancelDownload', url: url, id: dlId });
      finishDownloadUI(dlId || url, false);
    });
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

  browser.storage.onChanged.addListener((changes, area) => {
    const activeNavigationTab = document.getElementById('navbar')?.value;
    if (area === 'session') {
      if (activeNavigationTab !== 'home') navigationPageLoads.delete('home');
      return;
    }
    if (area !== 'local') return;

    if (Object.prototype.hasOwnProperty.call(changes, 'download-history')) {
      navigationPageLoads.delete('history');
    }

    const mediaFilterSettings = [
      'only-video', 'only-audio', 'only-stream', 'only-image',
      'only-subtitle', 'only-file', 'ignore-disabled-types', 'hide-segments', 'disable-deduplication',
      'min-file-size', 'min-file-size-custom'
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

    if (changes['theme-color'] || changes['theme-mode']) {
      initTheme();
    }

    if (changes['ui-scale']) {
      document.documentElement.style.zoom = changes['ui-scale'].newValue || '85%';
    }
  });

  document.getElementById('refresh-list').addEventListener('click', () => loadMediaList());
  document.getElementById('clear-list').addEventListener('click', () => clearMediaList());
  document.getElementById('media-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('#add-manual-url-btn-empty');
    if (btn) {
      const url = await showAddManualUrlDialog();
      if (url) {
        addManualUrl(url);
      }
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
        <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> ${browser.i18n.getMessage("githubRepositoryLabel") || "GitHub Repository"}
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
        <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> ${browser.i18n.getMessage("githubRepositoryLabel") || "GitHub Repository"}
      `;
      showDialog(browser.i18n.getMessage("aboutChangelogDescription"), browser.i18n.getMessage("aboutChangelogTitle"), [githubButton]);
    }
  });

  const mode = urlParams.get('mode');
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
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

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'audioJobUpdate' && message.complete) {
    finishDownloadUI(message.jobId, !!message.success);
    sendResponse({ success: true });
    return;
  }
  if (message.action === 'customStatus' || message.action === 'audioPopupStatus' || message.action === 'streamPopupStatus') {
    let item = uiCache.get(message.id);
    if (!item) {
      const mediaItems = document.querySelectorAll('.media-item');
      for (const el of mediaItems) {
        if (el.dataset.downloadId === message.id || el.dataset.url === message.id) {
          let progressContainer = el.querySelector('.download-progress-container');
          if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.className = 'download-progress-container';
            el.appendChild(progressContainer);
          }

          let loadingBar = progressContainer.querySelector('mdui-linear-progress');
          if (!loadingBar) {
            loadingBar = document.createElement('mdui-linear-progress');
            progressContainer.appendChild(loadingBar);
          }

          let statusInfo = progressContainer.querySelector('.download-status-info');
          if (!statusInfo) {
            statusInfo = document.createElement('div');
            statusInfo.className = 'download-status-info';
            progressContainer.appendChild(statusInfo);
          }

          const dlBtn = el.querySelector('#download-button');
          const audioBtn = el.querySelector('#audio-only-button');
          const prvBtn = el.querySelector('mdui-segmented-button:not(#download-button):not(#audio-only-button):not(#cancel-button)');
          const cancelBtn = el.querySelector('#cancel-button');

          item = { loadingBar, statusInfo, element: el, progressContainer, dlBtn, audioBtn, prvBtn, cancelBtn };
          uiCache.set(message.id, item);
          if (el.dataset.downloadId) uiCache.set(el.dataset.downloadId, item);
          if (el.dataset.url) uiCache.set(el.dataset.url, item);
          break;
        }
      }
    }
    if (item) {
        if (!activeDownloadingElements.includes(item.element)) {
            activeDownloadingElements.push(item.element);
        }
        if (item.dlBtn) {
            if (item.cancelBtn) item.cancelBtn.style.display = 'inline-flex';
            item.dlBtn.style.borderRadius = '';
            if (item.audioBtn) item.audioBtn.style.display = 'none';
        }
        if (message.text) item.statusInfo.textContent = message.text;
        if (message.percent !== undefined) {
            item.loadingBar.removeAttribute('indeterminate');
            item.loadingBar.max = 100;
            item.loadingBar.value = message.percent;
        } else if (message.indeterminate) {
            item.loadingBar.setAttribute('indeterminate', 'true');
        }
    }
    sendResponse({ success: true });
    return;
  }
  if (message.action === 'downloadProgress') {
    updateProgressUI(message.id || message.url, message.loaded, message.total, message.isParallel, message.isPaused, message.status, message.percent, message.finishedParts, message.totalParts);
  } else if (message.action === 'downloadPaused') {
    updateProgressUI(message.id, message.loaded, message.total, false, true);
  } else if (message.action === 'zipProgress') {
    const progressContainer = document.getElementById('global-progress-container');
    const progressBar = document.getElementById('global-progress-bar');
    const progressText = document.getElementById('global-progress-text');
    const cancelGlobalBtn = document.getElementById('cancel-global-operation');

    progressContainer.style.display = 'flex';
    progressBar.value = (message.loaded / message.total) * 100;
    if (cancelGlobalBtn) {
      cancelGlobalBtn.style.display = 'inline-block';
      cancelGlobalBtn.onclick = () => {
        browser.runtime.sendMessage({ action: 'cancelDownload', id: message.id }).catch(() => {});
        progressContainer.style.display = 'none';
      };
    }

    if (message.status === 'downloading') {
      progressText.textContent = (message.isPaused ? `[${browser.i18n.getMessage("pausedStatus") || "Paused"}] ` : "") + browser.i18n.getMessage("zipDownloading", [(message.loaded + 1).toString(), message.total.toString(), message.currentFile]);
    } else if (message.status === 'generating') {
      progressBar.value = 95;
      progressText.textContent = (message.isPaused ? `[${browser.i18n.getMessage("pausedStatus") || "Paused"}] ` : "") + (browser.i18n.getMessage("zipGenerating") || "Generating ZIP archive...");
    } else if (message.status === 'uploading') {
      progressBar.indeterminate = message.percent === undefined;
      if (message.percent !== undefined) progressBar.value = message.percent;
      const statusText = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...");
      progressText.textContent = (message.isPaused ? `[${browser.i18n.getMessage("pausedStatus") || "Paused"}] ` : "") + statusText + (message.percent !== undefined ? ` (${message.percent}%)` : "");
    } else if (message.status === 'processingStream') {
      progressBar.indeterminate = message.percent === undefined || message.indeterminate;
      if (message.percent !== undefined) progressBar.value = message.percent;
      progressText.textContent = `${message.currentFile || ''}${message.currentFile ? ' • ' : ''}${message.text || 'Processing stream...'}`;
    }
  } else if (message.action === 'zipComplete') {
    const progressContainer = document.getElementById('global-progress-container');
    const progressBar = document.getElementById('global-progress-bar');
    const progressText = document.getElementById('global-progress-text');
    const cancelGlobalBtn = document.getElementById('cancel-global-operation');

    if (cancelGlobalBtn) cancelGlobalBtn.style.display = 'none';
    progressBar.value = 1;
    progressBar.indeterminate = false;

    if (message.cloud) {
       let successMsg = browser.i18n.getMessage("uploadSuccessGDrive", [message.filename]) || `Successfully saved ${message.filename} to Google Drive!`;
       if (message.cloud === 'dropbox') {
           successMsg = successMsg.replace(/Google Drive/g, "Dropbox");
       }
       progressText.textContent = successMsg;
    } else {
       progressText.textContent = browser.i18n.getMessage("zipComplete");
    }

    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 3000);
  } else if (message.action === 'zipError') {
    const progressContainer = document.getElementById('global-progress-container');
    const progressText = document.getElementById('global-progress-text');
    const cancelGlobalBtn = document.getElementById('cancel-global-operation');

    if (cancelGlobalBtn) cancelGlobalBtn.style.display = 'none';
    progressText.textContent = browser.i18n.getMessage("zipError", [message.error]);
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 5000);
  } else if (message.action === 'confirmZipSkip') {
    showConfirmDialog(
      browser.i18n.getMessage("zipDownloadError", [message.filename, message.error || ""]),
      browser.i18n.getMessage("downloadErrorTitle") || "Download Error"
    ).then(result => {
      browser.runtime.sendMessage({ action: 'confirmZipSkipResponse', result: result });
    });
    return true;
  } else if (message.action === 'downloadComplete') {
    const dlId = message.id || message.url;
    finishDownloadUI(dlId, true);

    if (message.url && message.url !== dlId) {
      finishDownloadUI(message.url, true);
    }

    if (message.url) {
      allMediaRequests = allMediaRequests.filter(item => item.bestRequest.originalUrl !== message.url);
      allFilteredRequests = allFilteredRequests.filter(item => item.bestRequest.originalUrl !== message.url);
    }
  } else if (message.action === 'downloadError') {
    const id = message.id || message.url;
    const itemData = uiCache.get(id);

    finishDownloadUI(id, false);

    if (!itemData && !document.querySelector(`.media-item[data-url="${message.url}"]`)) {
      console.debug("Ignored background download error for untracked item:", message.url);
      return;
    }

    if (message.error === "USER_CANCELED") {
      if (typeof mdui !== 'undefined' && mdui.snackbar) {
        mdui.snackbar({
          message: browser.i18n.getMessage("downloadCancelled") || "Download cancelled",
          placement: "top"
        });
      }
      finishDownloadUI(id, false);
      return;
    }

    if (typeof mdui !== 'undefined' && mdui.snackbar) {
      mdui.snackbar({
        message: browser.i18n.getMessage("downloadError", [message.error]) || ("Download error: " + message.error),
        placement: "top"
      });
    } else {
      showDialog(browser.i18n.getMessage("downloadError", [message.error]) || ("Download error: " + message.error));
    }
  }
});

function updateProgressUI(id, loaded, total, isParallel = false, isPaused = false, status = 'downloading', percent = null, finishedParts = null, totalParts = null) {
  let item = uiCache.get(id);

  if (!item) {
    const mediaItems = document.querySelectorAll('.media-item');
    for (const el of mediaItems) {
      if (el.dataset.downloadId === id || el.dataset.url === id) {
        let progressContainer = el.querySelector('.download-progress-container');
        if (!progressContainer) {
          progressContainer = document.createElement('div');
          progressContainer.className = 'download-progress-container';
          el.appendChild(progressContainer);
        }

        let loadingBar = progressContainer.querySelector('mdui-linear-progress');
        if (!loadingBar) {
          loadingBar = document.createElement('mdui-linear-progress');
          progressContainer.appendChild(loadingBar);
        }

        let statusInfo = progressContainer.querySelector('.download-status-info');
        if (!statusInfo) {
          statusInfo = document.createElement('div');
          statusInfo.className = 'download-status-info';
          progressContainer.appendChild(statusInfo);
        }

        const dlBtn = el.querySelector('#download-button');
        const audioBtn = el.querySelector('#audio-only-button');
        const prvBtn = el.querySelector('mdui-segmented-button:not(#download-button):not(#audio-only-button):not(#cancel-button)');
        const cancelBtn = el.querySelector('#cancel-button');

        item = { loadingBar, statusInfo, element: el, progressContainer, dlBtn, audioBtn, prvBtn, cancelBtn };
        uiCache.set(id, item);
        if (el.dataset.downloadId) uiCache.set(el.dataset.downloadId, item);
        if (el.dataset.url) uiCache.set(el.dataset.url, item);
        break;
      }
    }
  }

  if (item) {
    if (!activeDownloadingElements.includes(item.element)) {
      activeDownloadingElements.push(item.element);
    }
    const { loadingBar, statusInfo, dlBtn, cancelBtn, audioBtn } = item;

    if (dlBtn) {
        updatePausePlayUI(dlBtn, isPaused);
        if (cancelBtn) {
          cancelBtn.style.display = 'inline-flex';
          dlBtn.style.borderRadius = '';
        }
        if (audioBtn) audioBtn.style.display = 'none';
    }

    if (isParallel) {
        statusInfo.style.color = 'rgb(var(--mdui-color-primary))';
        statusInfo.style.fontWeight = 'bold';
    } else {
        statusInfo.style.color = '';
        statusInfo.style.fontWeight = '';
    }

    if (isPaused) {
        statusInfo.style.opacity = '0.7';
    } else {
        statusInfo.style.opacity = '1';
    }

    if (status === 'uploading') {
        const pct = percent || (total > 0 ? Math.round((loaded / total) * 100) : 0);
        loadingBar.value = 100;
        loadingBar.indeterminate = false;
        loadingBar.classList.add('uploading-phase');
        const statusText = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...");
        statusInfo.textContent = (isPaused ? `[${browser.i18n.getMessage("pausedStatus") || "Paused"}] ` : "") + statusText + ` (${pct}%)`;
        return;
    }

    const now = performance.now();
    if (!item.speedTime || isPaused || loaded < item.speedBytes) {
        item.speedTime = now;
        item.speedBytes = loaded;
        if (isPaused) item.currentSpeedStr = '';
    } else {
        const elapsed = now - item.speedTime;
        if (elapsed >= 1000) {
            const diffBytes = loaded - item.speedBytes;
            if (diffBytes > 0) {
                const bps = (diffBytes / elapsed) * 1000;
                const mbps = (bps / (1024 * 1024)).toFixed(2);
                if (mbps >= 1) {
                    item.currentSpeedStr = ` • ${mbps} MB/s`;
                } else {
                    const kbps = (bps / 1024).toFixed(0);
                    item.currentSpeedStr = ` • ${kbps} KB/s`;
                }
            } else {
                item.currentSpeedStr = ` • 0 KB/s`;
            }
            item.speedTime = now;
            item.speedBytes = loaded;
        }
    }
    const speedText = item.currentSpeedStr || '';

    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
    if (total > 0) {
      const totalMB = (total / (1024 * 1024)).toFixed(2);
      const percent = Math.round((loaded / total) * 100);
      const remainingMB = ((total - loaded) / (1024 * 1024)).toFixed(2);

      let text;
      if (isParallel && finishedParts !== null && totalParts !== null) {
          const partsPercent = Math.round((finishedParts / totalParts) * 100);
          text = (browser.i18n.getMessage("parallelPartProgress", [finishedParts.toString(), totalParts.toString(), partsPercent.toString()]) || `Parts: ${finishedParts}/${totalParts} (${partsPercent}%)`) + ` • ${loadedMB}MB / ${totalMB}MB (${percent}%)${speedText}`;
      } else {
          text = (browser.i18n.getMessage("streamProgressWithSize", [loadedMB, totalMB, percent.toString(), remainingMB]) || `${loadedMB} MB / ${totalMB} MB (${percent}%) • ${remainingMB} MB remaining`) + speedText;
      }

      if (isPaused) text = `[Paused] ${text}`;
      statusInfo.textContent = text;
      loadingBar.indeterminate = false;
      loadingBar.max = 100;
      loadingBar.value = percent;
    } else {
      let text = (browser.i18n.getMessage("streamProgressNoSize", [loadedMB]) || `${loadedMB} MB downloaded`) + speedText;
      if (isPaused) text = `[Paused] ${text}`;
      statusInfo.textContent = text;
      if (loadingBar.indeterminate !== true && !loadingBar.value) {
          loadingBar.indeterminate = true;
      }
    }
  }
}

async function restoreActiveDownloadsUI(activeDownloadsPassed = null) {
  let activeDownloads = activeDownloadsPassed;
  if (!activeDownloads) {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
        const tabDownloads = await browser.tabs.sendMessage(activeTab.id, { action: 'get_active_downloads' }).catch(() => null);
        if (tabDownloads) {
          activeDownloads = tabDownloads;
        }
      }
    } catch (e) {}
    const bgDownloads = await browser.runtime.sendMessage({ action: 'getActiveDownloads' }).catch(() => null);
    if (bgDownloads) {
      activeDownloads = { ...activeDownloads, ...bgDownloads };
    }
  }
  if (!activeDownloads) return;

  const mediaItems = document.querySelectorAll('.media-item');
  const activeIds = Object.keys(activeDownloads);

  activeIds.forEach(id => {
    const downloadData = activeDownloads[id];
    const url = downloadData.url;

    if (downloadData.isZip) {
      const container = document.getElementById('global-progress-container');
      const bar = document.getElementById('global-progress-bar');
      const text = document.getElementById('global-progress-text');
      const cancel = document.getElementById('cancel-global-operation');
      if (container) container.style.display = 'flex';
      if (bar) {
        bar.max = downloadData.status === 'processingStream' ? 100 : Math.max(downloadData.total || 1, 1);
        bar.value = downloadData.percent ?? downloadData.loaded ?? 0;
        bar.indeterminate = downloadData.status === 'generating';
      }
      if (text) text.textContent = downloadData.status === 'generating'
        ? (browser.i18n.getMessage('zipGenerating') || 'Generating ZIP archive...')
        : (`${downloadData.currentFile || ''}${downloadData.currentFile ? ' • ' : ''}${downloadData.statusText || downloadData.status || browser.i18n.getMessage('zipPreparing') || 'Preparing ZIP...'}`);
      if (cancel) {
        cancel.style.display = 'inline-block';
        cancel.onclick = () => browser.runtime.sendMessage({ action: 'cancelDownload', id }).catch(() => {});
      }
      return;
    }

    let item = Array.from(mediaItems).find(el => {
      if (el.dataset.downloadId === id) return true;
      const elUrl = el.dataset.url;
      if (!elUrl || !url) return false;
      return elUrl === url || url.split('?')[0] === elUrl.split('?')[0];
    });

    if (item) {
      item.dataset.downloadId = id;
      if (url && !item.dataset.url) item.dataset.url = url;
      const dlBtn = item.querySelector('#download-button');
      if (dlBtn) updatePausePlayUI(dlBtn, downloadData.isPaused);
      const cancelBtn = item.querySelector('#cancel-button');
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
      const audioBtn = item.querySelector('#audio-only-button');
      if (audioBtn) audioBtn.style.display = 'none';
      if (downloadData.isAudioJob || downloadData.isStreamJob) {
        updateProgressUI(id, downloadData.percent || 0, 100, false, false, downloadData.status, downloadData.percent);
        const progressItem = uiCache.get(id);
        if (progressItem?.statusInfo) {
          let text = downloadData.status || 'Processing...';
          if (/^Downloading/i.test(text) && downloadData.total > 0) text += ` ${(downloadData.loaded / 1048576).toFixed(1)} MB / ${(downloadData.total / 1048576).toFixed(1)} MB`;
          else if (/^Downloading/i.test(text) && downloadData.loaded > 0) text += ` ${(downloadData.loaded / 1048576).toFixed(1)} MB`;
          progressItem.statusInfo.textContent = text;
        }
      } else {
        updateProgressUI(id, downloadData.loaded, downloadData.total, downloadData.isParallel, downloadData.isPaused, downloadData.status, downloadData.percent);
      }
      
      if (!activeDownloadingElements.includes(item)) {
        activeDownloadingElements.push(item);
      }
    }
  });

  mediaItems.forEach(item => {
    const jobId = item.dataset.downloadId || '';
    if (jobId.startsWith('audio_') && !activeIds.includes(jobId)) {
      finishDownloadUI(jobId, false);
    }
  });
}

// Popup documents can miss progress events while closed. Keep the visible UI
// reconciled with the authoritative background job state.
setInterval(() => {
  if (document.visibilityState === 'visible') restoreActiveDownloadsUI();
}, 750);

function finishDownloadUI(id, isSuccess = false) {
  const itemData = uiCache.get(id);
  if (itemData) {
      const { element, progressContainer } = itemData;
      activeDownloadingElements = activeDownloadingElements.filter(el => el !== element);

      if (isSuccess) {
          element.remove();

          const mediaContainer = document.getElementById('media-list');
          if (mediaContainer && mediaContainer.querySelectorAll('.media-item').length === 0) {
            renderInitialList();
          }
      } else {
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
      updateDownloadingCount(-1);
      return;
  }

  const mediaItems = document.querySelectorAll('.media-item');
  mediaItems.forEach(item => {
    if (item.dataset.downloadId === id || item.dataset.url === id) {
      activeDownloadingElements = activeDownloadingElements.filter(el => el !== item);
      if (isSuccess) {
        item.remove();

        const mediaContainer = document.getElementById('media-list');
        if (mediaContainer && mediaContainer.querySelectorAll('.media-item').length === 0) {
          renderInitialList();
        }
      } else {
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

      updateDownloadingCount(-1);
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

function showConfirmDialog(message, title = null) {
  return new Promise((resolve) => {
    const dialog = document.createElement('mdui-dialog');
    dialog.headline = title || browser.i18n.getMessage("confirmTitle") || "Confirm";

    const description = document.createElement('div');
    description.setAttribute('slot', 'description');
    description.style.whiteSpace = 'pre-wrap';
    description.innerHTML = message;
    dialog.appendChild(description);

    const cancelButton = document.createElement('mdui-button');
    cancelButton.variant = "text";
    cancelButton.textContent = browser.i18n.getMessage("cancelAllButton");
    cancelButton.slot = 'action';
    cancelButton.addEventListener('click', () => {
      dialog.open = false;
      resolve('cancel');
    });
    dialog.appendChild(cancelButton);

    const continueButton = document.createElement('mdui-button');
    continueButton.variant = "tonal";
    continueButton.textContent = browser.i18n.getMessage("continueAllButton");
    continueButton.slot = 'action';
    continueButton.addEventListener('click', () => {
      dialog.open = false;
      resolve('continue-all');
    });
    dialog.appendChild(continueButton);

    document.body.appendChild(dialog);
    dialog.open = true;

    dialog.addEventListener('closed', () => {
      dialog.remove();
    });
  });
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
    dialog.headline = title || browser.i18n.getMessage("aboutChangelogTitle") || "Changelog";
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

async function showQRCode(url) {
  await ensureScriptLoaded('libraries/qrcode.min.js', 'qrcode');
  const typeNumber = 0;
  const errorCorrectionLevel = 'L';
  const qr = qrcode(typeNumber, errorCorrectionLevel);
  qr.addData(url);
  qr.make();

  const uniqueId = 'qr-img-' + Date.now();
  const qrImageTag = qr.createImgTag(5);
  const modifiedQrImageTag = qrImageTag.replace('<img', `<img id="${uniqueId}" style="max-width: 100%; height: auto; cursor: zoom-in;" title="Click to enlarge"`);
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.gap = '16px';
  container.style.padding = '16px 0';
  container.innerHTML = `
    <div style="background: white; padding: 12px; border-radius: 8px; max-width: 250px; display: flex; justify-content: center;">
      ${modifiedQrImageTag}
    </div>
    <div style="word-break: break-all; font-size: 12px; opacity: 0.7; text-align: center; max-width: 250px;">
      ${url}
    </div>
  `;

  const openButton = document.createElement('mdui-button');
  openButton.variant = "text";
  openButton.textContent = browser.i18n.getMessage("qrCodeDialogOpenButton") || "Open";
  openButton.slot = 'action';
  openButton.addEventListener('click', () => {
    const iframeDialog = document.createElement('mdui-dialog');
    iframeDialog.closeOnOverlayClick = true;
    iframeDialog.closeOnEsc = true;
    iframeDialog.fullscreen = true;

    const headline = document.createElement('div');
    headline.setAttribute('slot', 'headline');
    headline.style.width = '100%';
    headline.style.display = 'flex';
    headline.style.justifyContent = 'space-between';
    headline.style.alignItems = 'center';

    const titleText = document.createElement('span');
    titleText.textContent = url;
    titleText.style.fontSize = '14px';
    titleText.style.overflow = 'hidden';
    titleText.style.textOverflow = 'ellipsis';
    titleText.style.whiteSpace = 'nowrap';
    titleText.style.maxWidth = '70%';

    headline.appendChild(titleText);
    iframeDialog.appendChild(headline);

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.width = '100%';
    iframe.style.height = 'calc(100vh - 80px)';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';

    const copyBtn = document.createElement('mdui-button');
    copyBtn.variant = "text";
    copyBtn.textContent = browser.i18n.getMessage("copyURL") || "Copy URL";
    copyBtn.slot = 'action';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = browser.i18n.getMessage("copyURLSuccess") || "Copied!";
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 2000);
      });
    });

    const openTabBtn = document.createElement('mdui-button');
    openTabBtn.variant = "text";
    openTabBtn.textContent = (browser.i18n.getMessage("qrCodeDialogOpenButton") || "Open") + " Tab";
    openTabBtn.slot = 'action';
    openTabBtn.addEventListener('click', () => {
      browser.tabs.create({ url: url });
    });

    const closeBtn = document.createElement('mdui-button');
    closeBtn.variant = "text";
    closeBtn.textContent = browser.i18n.getMessage("cancelButton") || "Close";
    closeBtn.slot = 'action';
    closeBtn.addEventListener('click', () => {
      iframeDialog.open = false;
    });

    iframeDialog.appendChild(iframe);
    iframeDialog.appendChild(copyBtn);
    iframeDialog.appendChild(openTabBtn);
    iframeDialog.appendChild(closeBtn);
    document.body.appendChild(iframeDialog);
    iframeDialog.open = true;

    iframeDialog.addEventListener('closed', () => {
      iframeDialog.remove();
    });
  });

  showDialog(container.outerHTML, browser.i18n.getMessage("qrCodeDialogTitle") || "Scan QR Code", [openButton]);

  setTimeout(() => {
    const imgEl = document.getElementById(uniqueId);
    if (imgEl) {
      imgEl.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'white';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.cursor = 'zoom-out';

        const fullImg = document.createElement('img');
        fullImg.src = imgEl.src;
        fullImg.style.width = '95vmin';
        fullImg.style.height = '95vmin';
        fullImg.style.imageRendering = 'pixelated';

        overlay.appendChild(fullImg);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => overlay.remove());
      });
    }
  }, 100);
}

function getNoMediaDetectedHTML() {
  return `
    <div class="end-of-list-container no-media-container">
      <div class="end-of-list-title">${browser.i18n.getMessage("errorTitle4") || 'Info'}</div>
      <div class="end-of-list-text">${browser.i18n.getMessage("noMediaDetected")}</div>
      <mdui-button variant="tonal" id="add-manual-url-btn-empty" style="margin-top: 12px; --mdui-shape-corner-extra-small: 16px;"><mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></mdui-icon><span data-translate="addManualUrlButton">Add URL</span></mdui-button>
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
    cb.closest('.media-item').querySelector('mdui-linear-progress')
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
    allFilteredRequests = allMediaRequests.filter(item => {
      const { bestRequest } = item;
      const pageTitle = (bestRequest.pageTitle || '').toLowerCase();
      const headline = getFileName(bestRequest.originalUrl, 200).toLowerCase();
      const url = bestRequest.originalUrl.toLowerCase();
      const type = (item.type || '').toLowerCase();
      let hostname = '';
      try { hostname = new URL(bestRequest.originalUrl).hostname.toLowerCase(); } catch(e) {}

      return pageTitle.includes(lowerQuery) || headline.includes(lowerQuery) || url.includes(lowerQuery) || hostname.includes(lowerQuery) || type.includes(lowerQuery);
    });
  }

  renderInitialList();
}

function getGroupCounts(activeItems) {
  const counts = {
    video: 0,
    audio: 0,
    stream: 0,
    image: 0,
    subtitle: 0,
    file: 0
  };

  allFilteredRequests.forEach(item => {
    const type = item.type || 'file';
    if (counts[type] !== undefined) {
      counts[type]++;
    } else {
      counts.file++;
    }
  });

  activeItems.forEach(item => {
    const type = item.dataset.type || 'file';
    if (counts[type] !== undefined) {
      counts[type]++;
    } else {
      counts.file++;
    }
  });

  return counts;
}

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
      align-items: center;
      padding: 16px 20px;
      gap: 16px;
    ">
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
    if (!(node instanceof Element)) return;
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

function renderInitialList() {
  const mediaContainer = document.getElementById('media-list');
  ensureMediaPreviewCleanupObserver(mediaContainer);
  const mediaControls = document.getElementById('media-controls');
  mediaControls?.querySelector('#back-to-groups-btn')?.remove();
  const query = document.getElementById('search-bar').value.trim();

  const activeItems = [...activeDownloadingElements];

  mediaContainer.innerHTML = '';
  uiCache.clear();
  renderedMediaUrls.clear();
  activeItems.forEach(item => {
    const url = item.dataset.url;
    if (url) {
      renderedMediaUrls.add(url);
      renderedMediaUrls.add(url.split('?')[0]);
    }
  });
  renderedCount = 0;
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
    const hasItems = Object.values(counts).some(c => c > 0);

    if (!hasItems) {
      mediaContainer.innerHTML = getNoMediaDetectedHTML();
      if (mediaControls) mediaControls.style.display = 'none';
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
        });
        mediaContainer.appendChild(cardEl);
      }
    });

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
    activeItems.forEach(item => mediaContainer.appendChild(item));
  } else {
    activeItems.forEach(item => mediaContainer.appendChild(item));
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
        emptyMsg.innerHTML = `<div id="no-matches-msg" style="padding: 60px 20px; text-align: center; opacity: 0.8;">No matches found for "${query}"</div>`;
      } else {
        emptyMsg.innerHTML = getNoMediaDetectedHTML();
      }
      mediaContainer.appendChild(emptyMsg);
    } else {
      if (query) {
        mediaContainer.innerHTML = `<div id="no-matches-msg" style="padding: 60px 20px; text-align: center; opacity: 0.8;">No matches found for "${query}"</div>`;
      } else {
        mediaContainer.innerHTML = getNoMediaDetectedHTML();
      }
      if (mediaControls && !query) mediaControls.style.display = 'none';
    }
    updateSelectedCount();
    return;
  }

  if (mediaControls) mediaControls.style.display = 'flex';
  renderNextChunk();
  restoreActiveDownloadsUI();
  updateSelectedCount();
}

function renderNextChunk() {
  if (isRenderingChunk) return;
  isRenderingChunk = true;
  const mediaContainer = document.getElementById('media-list');
  const fragment = document.createDocumentFragment();
  const requestsToRender = getActiveRequests();
  const nextChunk = requestsToRender.slice(renderedCount, renderedCount + CHUNK_SIZE);

  nextChunk.forEach(item => {
    const itemUrl = item.bestRequest.originalUrl;
    const itemUrlBase = itemUrl.split('?')[0];
    if (renderedMediaUrls.has(itemUrl) || renderedMediaUrls.has(itemUrlBase)) return;
    renderedMediaUrls.add(itemUrl);
    renderedMediaUrls.add(itemUrlBase);

    const mediaDiv = createMediaItem(item);
    fragment.appendChild(mediaDiv);
  });

  const oldSentinel = document.getElementById('infinite-scroll-sentinel');
  if (oldSentinel) oldSentinel.remove();

  const oldEndMsg = document.getElementById('end-of-media-list');
  if (oldEndMsg) oldEndMsg.remove();

  mediaContainer.appendChild(fragment);
  renderedCount += nextChunk.length;

  if (renderedCount < requestsToRender.length) {
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
     <mdui-button variant="tonal" id="add-manual-url-btn-empty" style="margin-top: 12px; --mdui-shape-corner-extra-small: 16px;"><mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></mdui-icon><span data-translate="addManualUrlButton">Add URL</span></mdui-button>
   `;
   mediaContainer.appendChild(endMsg);
  }

  restoreActiveDownloadsUI();
  updateSelectedCount();
  isRenderingChunk = false;
}

const m3u8VariantsCache = new Map();

async function getM3U8Variants(url) {
    if (m3u8VariantsCache.has(url)) {
        return m3u8VariantsCache.get(url);
    }
    try {
        const response = await spoofedFetch(url);
        if (!response.ok) return [];
        const text = await response.text();
        if (!text.includes("#EXT-X-STREAM-INF")) {
            m3u8VariantsCache.set(url, []);
            return [];
        }

        const lines = text.split("\n");
        const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
        const variants = [];

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
                const resolution = resMatch ? resMatch[1] : "unknown";
                const uri = lines[i + 1];
                if (uri) {
                    variants.push({
                        bandwidth,
                        resolution,
                        uri: uri.trim().startsWith("http") ? uri.trim() : baseUrl + uri.trim()
                    });
                }
            }
        }
        m3u8VariantsCache.set(url, variants);
        return variants;
    } catch (e) {
        console.warn("Failed to parse variants for", url, e);
        m3u8VariantsCache.set(url, []);
        return [];
    }
}

const mpdVariantsCache = new Map();

async function getMPDVariants(url) {
    if (mpdVariantsCache.has(url)) {
        return mpdVariantsCache.get(url);
    }
    try {
        const response = await spoofedFetch(url);
        if (!response.ok) return [];
        const text = await response.text();
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "application/xml");
        const NS = xmlDoc.documentElement.namespaceURI || "urn:mpeg:dash:schema:mpd:2011";
        
        const periodList = xmlDoc.getElementsByTagNameNS(NS, "Period");
        if (!periodList || periodList.length === 0) {
            mpdVariantsCache.set(url, []);
            return [];
        }
        const period = periodList[0];
        const allSets = Array.from(period.getElementsByTagNameNS(NS, "AdaptationSet"));
        const videoSet = allSets.find(asNode => {
            const mimeType = asNode.getAttribute("mimeType")?.toLowerCase() || "";
            const contentType = asNode.getAttribute("contentType")?.toLowerCase() || "";
            if (mimeType.startsWith("video/") || contentType === "video") return true;
            const reps = asNode.getElementsByTagNameNS(NS, "Representation");
            for (let i = 0; i < reps.length; i++) {
                const rm = reps[i].getAttribute("mimeType")?.toLowerCase() || "";
                if (rm.startsWith("video/")) return true;
            }
            return false;
        });
        
        if (!videoSet) {
            mpdVariantsCache.set(url, []);
            return [];
        }
        
        const repNodes = Array.from(videoSet.getElementsByTagNameNS(NS, "Representation"));
        const variants = [];
        repNodes.forEach(rNode => {
            const id = rNode.getAttribute("id");
            const bandwidth = parseInt(rNode.getAttribute("bandwidth") || "0", 10);
            const width = parseInt(rNode.getAttribute("width") || "0", 10);
            const height = parseInt(rNode.getAttribute("height") || "0", 10);
            if (width && height) {
                variants.push({
                    bandwidth,
                    resolution: `${width}x${height}`,
                    id: id
                });
            }
        });
        
        mpdVariantsCache.set(url, variants);
        return variants;
    } catch (e) {
        console.warn("Failed to parse MPD variants for", url, e);
        mpdVariantsCache.set(url, []);
        return [];
    }
}


function createMediaItem(item) {
  const { bestRequest, isVideo, isAudio, isStream, isSubtitle, isFile, isImage } = item;
  const ytFormats = item.ytFormats || null;
  const mediaURL = new URL(bestRequest.originalUrl);

  const mediaDiv = document.createElement('div');
  mediaDiv.classList.add('media-item');
  mediaDiv.dataset.originalUrl = bestRequest.originalUrl;
  mediaDiv.dataset.url = bestRequest.originalUrl;
  mediaDiv.dataset.size = bestRequest.size;
  mediaDiv.dataset.type = isVideo ? 'video' : isAudio ? 'audio' : isStream ? 'stream' : isImage ? 'image' : isSubtitle ? 'subtitle' : 'file';
  if (ytFormats) {
    mediaDiv.ytFormats = ytFormats;
  }
  if (item.ytSubtitles) {
    mediaDiv.ytSubtitles = item.ytSubtitles;
  }

  let activeUrl = bestRequest.originalUrl;
  let activeAudioUrl = null;
  let activeSize = bestRequest.size;

  let hls = null;
  let hlsLarge = null;
  let isSyncing = false;
  let resolvedM3u8Url = null;

  const getPlayableUrl = async (url) => {
    if (!url) return url;
    if (url.toLowerCase().includes('.mpd')) {
      if (resolvedM3u8Url) return resolvedM3u8Url;
      try {
        resolvedM3u8Url = await getM3u8BlobUrlFromMpd(url, bestRequest.responseHeaders);
        return resolvedM3u8Url;
      } catch (e) {
        console.error("MPD to M3U8 conversion failed:", e);
        return url;
      }
    }
    return url;
  };

  const updateHlsQuality = (hlsInstance, selectedResolution) => {
    if (!hlsInstance || !hlsInstance.levels || hlsInstance.levels.length === 0) return;
    if (!selectedResolution) {
      hlsInstance.currentLevel = -1;
      return;
    }
    const parts = selectedResolution.split('@');
    const resolution = parts[0];
    const bandwidth = parseInt(parts[1], 10);

    let levelIndex = hlsInstance.levels.findIndex(lvl => {
      if (lvl.bitrate === bandwidth) return true;
      if (resolution && resolution !== 'unknown') {
        const lvlRes = `${lvl.width}x${lvl.height}`;
        if (lvlRes === resolution) return true;
      }
      return false;
    });

    if (levelIndex === -1) {
      let minDiff = Infinity;
      hlsInstance.levels.forEach((lvl, index) => {
        const diff = Math.abs(lvl.bitrate - bandwidth);
        if (diff < minDiff) {
          minDiff = diff;
          levelIndex = index;
        }
      });
    }

    if (levelIndex !== -1) {
      hlsInstance.currentLevel = levelIndex;
    }
  };

  const ensureHlsLoaded = async (targetVideo, isLargeTarget) => {
    if (!isStream) return;
    await ensureScriptLoaded('libraries/hls.js', 'Hls');
    if (isLargeTarget) {
      if (!hlsLarge) {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          const finalUrl = await getPlayableUrl(activeUrl);
          hlsLarge = new Hls();
          hlsLarge.loadSource(finalUrl);
          hlsLarge.attachMedia(targetVideo);
          await new Promise(resolve => {
            hlsLarge.on(Hls.Events.MANIFEST_PARSED, () => {
              updateHlsQuality(hlsLarge, mediaDiv.dataset.selectedResolution);
              resolve();
            });
          });
        } else if (targetVideo.canPlayType('application/vnd.apple.mpegurl')) {
          const finalUrl = await getPlayableUrl(activeUrl);
          targetVideo.src = finalUrl;
        }
      }
    } else {
      if (!hls) {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          const finalUrl = await getPlayableUrl(bestRequest.originalUrl);
          hls = new Hls();
          hls.loadSource(finalUrl);
          hls.attachMedia(targetVideo);
          await new Promise(resolve => {
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              updateHlsQuality(hls, mediaDiv.dataset.selectedResolution);
              resolve();
            });
          });
        } else if (targetVideo.canPlayType('application/vnd.apple.mpegurl')) {
          const finalUrl = await getPlayableUrl(bestRequest.originalUrl);
          targetVideo.src = finalUrl;
        }
      }
    }
  };

  const syncPlayback = async (src, dest, isDestLarge) => {
    if (isSyncing) return;
    isSyncing = true;
    try {
      if (src.paused !== dest.paused) {
        if (src.paused) {
          dest.pause();
        } else {
          if (isStream) {
            await ensureHlsLoaded(dest, isDestLarge);
          } else if (!dest.src || dest.src === window.location.href) {
            dest.src = src.src || src.currentSrc;
          }
          dest.muted = dest.paused ? dest.muted : src.muted;
          dest.play().catch(e => console.warn("Sync play failed:", e));
        }
      }
      if (!isStream && Math.abs(src.currentTime - dest.currentTime) > 0.3) {
        dest.currentTime = src.currentTime;
      }
    } catch (err) {
      console.warn("Sync failed:", err);
    }
    isSyncing = false;
  };

  const header = document.createElement('div');
  header.classList.add('media-item-header');

  const checkbox = document.createElement('mdui-checkbox');
  checkbox.classList.add('media-checkbox');
  checkbox.checked = selectedUrls.has(bestRequest.originalUrl);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      selectedUrls.add(bestRequest.originalUrl);
    } else {
      selectedUrls.delete(bestRequest.originalUrl);
      const selectAll = document.getElementById('select-all-checkbox');
      if (selectAll) selectAll.checked = false;
    }
    updateSelectedCount();
  });
  header.appendChild(checkbox);

  const previewContainer = document.createElement('div');
  previewContainer.classList.add('media-preview-container');

  let video = null;

  if (isVideo || isStream) {
    previewContainer.classList.add('video');
    video = document.createElement('video');
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    mediaDiv.loadMediaPreview = () => {
      if (isStream || video.dataset.previewLoaded === '1') return;
      video.dataset.previewLoaded = '1';
      video.src = bestRequest.originalUrl;
      video.addEventListener('loadedmetadata', () => {
        if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration);
      }, { once: true });
    };
    if (!isStream) mediaPreviewLoadObserver.observe(mediaDiv);
    previewContainer.appendChild(video);

    video.addEventListener('play', () => {
      previewContainer.classList.add('playing');
      const isExpanded = mediaDiv.classList.contains('expanded');
      video.muted = isExpanded;
      if (typeof largeVideo !== 'undefined') largeVideo.muted = !isExpanded;
      syncPlayback(video, largeVideo, true);
    });
    video.addEventListener('pause', () => {
      previewContainer.classList.remove('playing');
      syncPlayback(video, largeVideo, true);
    });
    video.addEventListener('ended', () => {
      previewContainer.classList.remove('playing');
      syncPlayback(video, largeVideo, true);
    });
    video.addEventListener('timeupdate', () => {
      syncPlayback(video, largeVideo, true);
    });

    previewContainer.addEventListener('click', async (e) => {
      e.stopPropagation();
      mediaDiv.loadMediaPreview?.();
      if (video.paused) {
        document.querySelectorAll('.media-preview-container.playing video').forEach(v => {
          v.pause();
        });

        if (isStream && !hls) {
          await ensureScriptLoaded('libraries/hls.js', 'Hls');
          if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const finalUrl = await getPlayableUrl(bestRequest.originalUrl);
            hls = new Hls();
            hls.loadSource(finalUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              updateHlsQuality(hls, mediaDiv.dataset.selectedResolution);
              const isExpanded = mediaDiv.classList.contains('expanded');
              video.muted = isExpanded;
              video.play().catch(err => console.error("Playback failed:", err));
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            const finalUrl = await getPlayableUrl(bestRequest.originalUrl);
            video.src = finalUrl;
            const isExpanded = mediaDiv.classList.contains('expanded');
            video.muted = isExpanded;
            video.play().catch(err => console.error("Playback failed:", err));
          }
        } else {
          const isExpanded = mediaDiv.classList.contains('expanded');
          video.muted = isExpanded;
          video.play().catch(err => console.error("Playback failed:", err));
        }
      } else {
        video.pause();
      }
    });
  } else if (isImage) {
    const img = document.createElement('img');
    img.src = bestRequest.originalUrl;
    img.loading = "lazy";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.onerror = () => {
      img.remove();
      const fallback = document.createElement('mdui-icon');
      fallback.classList.add('media-preview-icon');
      fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z"/></svg>`;
      previewContainer.appendChild(fallback);
    };
    previewContainer.appendChild(img);
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
  header.appendChild(previewContainer);

  const info = document.createElement('div');
  info.classList.add('media-item-info');

  const headline = document.createElement('div');
  headline.classList.add('media-headline');
  const displayTitle = item.resolvedFilename || mediaFilename.resolve(bestRequest?.originalUrl || bestRequest?.url || "", bestRequest || {});
  headline.textContent = displayTitle;
  info.appendChild(headline);

  const description = document.createElement('div');
  description.classList.add('media-description');
  const timeStr = new Date(bestRequest.timeStamp).toLocaleTimeString();
  const humanSize = getHumanReadableSize(bestRequest.size);

  let resLabel = '';
  if (ytFormats && ytFormats.length > 0 && ytFormats[0].label) {
    resLabel = ` • ${ytFormats[0].label}`;
  }
  description.textContent = `${mediaURL.hostname} • ${humanSize}${resLabel} • ${timeStr}`;
  info.appendChild(description);
  header.appendChild(info);

  const qrBtn = document.createElement('mdui-button-icon');
  qrBtn.innerHTML = `<mdui-icon><svg viewBox="0 -960 960 960"><path d="M120-120v-240h80v160h160v80H120Zm0-480v-240h240v80H200v160h-80Zm480 480v-80h160v-160h80v240H600Zm160-480v-160H600v-80h240v240h-80ZM280-280v-120h120v120H280Zm0-280v-120h120v120H280Zm280 280v-120h120v120H560Zm0-280v-120h120v120H560Z"/></svg></mdui-icon>`;
  qrBtn.title = browser.i18n.getMessage("qrCodeButton") || "QR Code";
  qrBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showQRCode(activeUrl);
  });
  header.appendChild(qrBtn);
  mediaDiv.appendChild(header);

  const inlinePreview = document.createElement('div');
  inlinePreview.classList.add('inline-preview-area');
  const largeVideo = document.createElement('video');
  largeVideo.controls = true;
  inlinePreview.appendChild(largeVideo);
  mediaDiv.appendChild(inlinePreview);

  mediaDiv.cleanupMediaPreview = () => {
    mediaPreviewLoadObserver.unobserve(mediaDiv);
    if (hls) {
      hls.destroy();
      hls = null;
    }
    if (hlsLarge) {
      hlsLarge.destroy();
      hlsLarge = null;
    }
    mediaDiv.querySelectorAll('video').forEach(media => {
      media.pause();
      media.removeAttribute('src');
      media.load();
    });
    if (resolvedM3u8Url?.startsWith('blob:')) URL.revokeObjectURL(resolvedM3u8Url);
    resolvedM3u8Url = null;
  };

  largeVideo.addEventListener('play', () => {
    if (!video) return;
    const isExpanded = mediaDiv.classList.contains('expanded');
    largeVideo.muted = !isExpanded;
    video.muted = isExpanded;
    syncPlayback(largeVideo, video, false);
  });
  largeVideo.addEventListener('pause', () => {
    if (!video) return;
    syncPlayback(largeVideo, video, false);
  });
  largeVideo.addEventListener('timeupdate', () => {
    if (!video) return;
    syncPlayback(largeVideo, video, false);
  });

  if ((isVideo || isStream) && !ytFormats && typeof embedSubtitlesWithLibAV !== 'undefined') {
     browser.storage.local.get(['embed-subtitles-nonyt']).then(res => {
         const embedSubtitlesNonYt = res['embed-subtitles-nonyt'] === '1';
         if (embedSubtitlesNonYt) {
             const subtitles = allMediaRequests.filter(req => req.type === 'subtitle' || req.isSubtitle);
             if (subtitles.length > 0) {
                 const subRow = document.createElement('div');
                 subRow.classList.add('yt-resolution-row');
                 subRow.style.marginTop = '8px';
                 subRow.style.width = '100%';

                 const subButtonWrapper = document.createElement('div');
                 subButtonWrapper.classList.add('pill-select-wrapper', 'nonyt-subtitle-select-wrapper');
                 subButtonWrapper.style.width = '100%';

                 const subButton = document.createElement('button');
                 subButton.classList.add('pill-select');
                 subButton.style.textAlign = 'center';
                 subButton.style.display = 'flex';
                 subButton.style.alignItems = 'center';
                 subButton.style.justifyContent = 'center';
                 subButton.style.gap = '6px';
                 subButton.style.cursor = 'pointer';
                 subButton.style.width = '100%';
                 subButton.style.paddingRight = '32px';
                 
                 const label = browser.i18n.getMessage("selectSubtitlesToEmbed") || "Select Subtitles";
                 subButton.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 4px; flex-shrink: 0;"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-4H6V8h12v4z"/></svg> <span class="sub-btn-text">${label} (0)</span>`;
                 
                 subButton.addEventListener('click', (e) => {
                     e.stopPropagation();
                     
                     const dialog = document.createElement('mdui-dialog');
                     dialog.headline = label;
                     
                     const container = document.createElement('div');
                     container.style.display = 'flex';
                     container.style.flexDirection = 'column';
                     container.style.gap = '8px';
                     container.style.marginTop = '16px';
                     container.style.maxHeight = '250px';
                     container.style.overflowY = 'auto';
                     
                     let currentSelected = [];
                     if (mediaDiv.dataset.selectedSubtitles) {
                         try {
                             currentSelected = JSON.parse(mediaDiv.dataset.selectedSubtitles);
                         } catch (err) {}
                     }
                     
                     const checkboxes = [];
                     subtitles.forEach((sub) => {
                         const mduiCheckbox = document.createElement('mdui-checkbox');
                         mduiCheckbox.value = sub.bestRequest.originalUrl;
                         mduiCheckbox.style.fontSize = '0.85rem';
                         const name = sub.resolvedFilename || getFileName(sub.bestRequest.originalUrl);
                         mduiCheckbox.textContent = name;
                         if (currentSelected.includes(sub.bestRequest.originalUrl)) {
                             mduiCheckbox.checked = true;
                         }
                         container.appendChild(mduiCheckbox);
                         checkboxes.push(mduiCheckbox);
                     });
                     dialog.appendChild(container);
                     
                     const cancelBtn = document.createElement('mdui-button');
                     cancelBtn.slot = "action";
                     cancelBtn.variant = "text";
                     cancelBtn.textContent = browser.i18n.getMessage("cancelButton") || "Cancel";
                     cancelBtn.addEventListener('click', () => {
                         dialog.open = false;
                     });
                     
                     const selectBtn = document.createElement('mdui-button');
                     selectBtn.slot = "action";
                     selectBtn.variant = "tonal";
                     selectBtn.textContent = browser.i18n.getMessage("selectButton") || "Select";
                     selectBtn.addEventListener('click', () => {
                         const newSelected = [];
                         checkboxes.forEach(cb => {
                             if (cb.checked) {
                                 newSelected.push(cb.value);
                             }
                         });
                         mediaDiv.dataset.selectedSubtitles = JSON.stringify(newSelected);
                         const btnText = subButton.querySelector('.sub-btn-text');
                         if (btnText) {
                             btnText.textContent = `${label} (${newSelected.length})`;
                         }
                         dialog.open = false;
                     });
                     
                     dialog.appendChild(cancelBtn);
                     dialog.appendChild(selectBtn);
                     
                     document.body.appendChild(dialog);
                     dialog.open = true;
                     
                     dialog.addEventListener('closed', () => {
                         dialog.remove();
                     });
                 });

                 subButtonWrapper.appendChild(subButton);
                 subRow.appendChild(subButtonWrapper);
                 actionsWrapper.insertBefore(subRow, actions);
             }
         }
     }).catch(err => console.error("Error reading embed-subtitles-nonyt setting:", err));
  }

  const actionsWrapper = document.createElement('div');
  actionsWrapper.classList.add('media-actions-wrapper');

  const isM3U8 = mediaURL.pathname.toLowerCase().includes('.m3u8');
  const isMPD = mediaURL.pathname.toLowerCase().includes('.mpd');
  if (isStream && (isM3U8 || isMPD)) {
    const resolutionRow = document.createElement('div');
    resolutionRow.classList.add('yt-resolution-row', 'stream-resolution-row');
    resolutionRow.style.display = 'none';
    resolutionRow.style.width = '100%';

    const resWrapper = document.createElement('div');
    resWrapper.classList.add('pill-select-wrapper');

    const resSelect = document.createElement('select');
    resSelect.classList.add('pill-select');

    const loadingOpt = document.createElement('option');
    loadingOpt.value = "";
    loadingOpt.textContent = browser.i18n.getMessage("loadingQualities") || "Loading qualities...";
    resSelect.appendChild(loadingOpt);

    resWrapper.appendChild(resSelect);
    resolutionRow.appendChild(resWrapper);
    actionsWrapper.appendChild(resolutionRow);

    const getVariantsPromise = isM3U8 
        ? getM3U8Variants(bestRequest.originalUrl) 
        : getMPDVariants(bestRequest.originalUrl);

    getVariantsPromise.then(async (variants) => {
        resSelect.innerHTML = '';
        if (variants && variants.length > 0) {
            const settings = await browser.storage.local.get("stream-quality");
            const preference = settings["stream-quality"] || "highest";

            const askOpt = document.createElement('option');
            askOpt.value = "";
            askOpt.textContent = browser.i18n.getMessage("askStreamQualityCheckbox") || "Ask every time";
            resSelect.appendChild(askOpt);

            variants.forEach((v) => {
                const opt = document.createElement('option');
                opt.value = isM3U8 ? `${v.resolution}@${v.bandwidth}` : `${v.resolution}@${v.bandwidth}@${v.id}`;
                const bwKbps = Math.round(v.bandwidth / 1000).toString();
                opt.textContent = `${v.resolution} (${bwKbps} kbps)`;
                resSelect.appendChild(opt);
            });

            let defaultVal = "";
            if (preference === "highest") {
                const highest = variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
                defaultVal = isM3U8 ? `${highest.resolution}@${highest.bandwidth}` : `${highest.resolution}@${highest.bandwidth}@${highest.id}`;
            } else if (preference === "lowest") {
                const lowest = variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
                defaultVal = isM3U8 ? `${lowest.resolution}@${lowest.bandwidth}` : `${lowest.resolution}@${lowest.bandwidth}@${lowest.id}`;
            }

            resSelect.value = defaultVal;
            mediaDiv.dataset.selectedResolution = defaultVal;

            resSelect.addEventListener('change', () => {
                const selectedResolution = resSelect.value;
                mediaDiv.dataset.selectedResolution = selectedResolution;
                if (hls) {
                    updateHlsQuality(hls, selectedResolution);
                }
                if (hlsLarge) {
                    updateHlsQuality(hlsLarge, selectedResolution);
                }
            });
            resolutionRow.style.display = 'flex';
        } else {
            resolutionRow.style.display = 'none';
        }
    }).catch(err => {
        console.error("Failed to load stream variants:", err);
        resolutionRow.style.display = 'none';
    });
  }

  if (ytFormats && ytFormats.length > 1) {
    const resolutionRow = document.createElement('div');
    resolutionRow.classList.add('yt-resolution-row');

    const formatWrapper = document.createElement('div');
    formatWrapper.classList.add('pill-select-wrapper', 'yt-format-select-wrapper');

    const formatSelect = document.createElement('select');
    formatSelect.classList.add('pill-select', 'yt-format-select');

    const codecWrapper = document.createElement('div');
    codecWrapper.classList.add('pill-select-wrapper', 'yt-codec-select-wrapper');

    const codecSelect = document.createElement('select');
    codecSelect.classList.add('pill-select', 'yt-codec-select');

    const resWrapper = document.createElement('div');
    resWrapper.classList.add('pill-select-wrapper', 'yt-resolution-select-wrapper');

    const resSelect = document.createElement('select');
    resSelect.classList.add('pill-select', 'yt-resolution-select');
    resSelect.id = 'yt-resolution-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

    const demuxers = [...new Set(ytFormats.map(fmt => fmt.demuxer))];
    demuxers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d.toUpperCase();
      formatSelect.appendChild(opt);
    });

    const defaultDemuxer = demuxers.includes('mp4') ? 'mp4' : demuxers[0];
    formatSelect.value = defaultDemuxer;

    function updateCodecDropdown() {
      codecSelect.innerHTML = '';
      const selectedDemuxer = formatSelect.value;
      const availableCodecs = [...new Set(ytFormats.filter(fmt => fmt.demuxer === selectedDemuxer).map(fmt => fmt.codec || 'UNKNOWN'))];

      availableCodecs.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        codecSelect.appendChild(opt);
      });

      if (availableCodecs.includes('AV1')) codecSelect.value = 'AV1';
      else if (availableCodecs.includes('VP9')) codecSelect.value = 'VP9';
      else if (availableCodecs.includes('H265')) codecSelect.value = 'H265';
      else if (availableCodecs.includes('H264')) codecSelect.value = 'H264';
      else codecSelect.value = availableCodecs[0];

      updateResolutionDropdown();
    }

    const langRow = document.createElement('div');
    langRow.classList.add('yt-resolution-row');
    langRow.style.marginTop = '8px';
    langRow.style.display = 'none';

    const langWrapper = document.createElement('div');
    langWrapper.classList.add('pill-select-wrapper', 'yt-language-select-wrapper');
    langWrapper.style.flex = '1';

    const langSelect = document.createElement('select');
    langSelect.classList.add('pill-select', 'yt-language-select');
    langWrapper.appendChild(langSelect);
    langRow.appendChild(langWrapper);

    const subWrapper = document.createElement('div');
    subWrapper.classList.add('pill-select-wrapper', 'yt-subtitle-select-wrapper');
    subWrapper.style.flex = '1';
    subWrapper.style.marginLeft = '8px';
    subWrapper.style.display = 'none';

    const subSelect = document.createElement('select');
    subSelect.classList.add('pill-select', 'yt-subtitle-select');
    subWrapper.appendChild(subSelect);
    langRow.appendChild(subWrapper);

    function updateResolutionDropdown() {
        resSelect.innerHTML = '';
        const selectedDemuxer = formatSelect.value;
        const selectedCodec = codecSelect.value;

        const availableFormats = ytFormats.filter(fmt =>
          fmt.demuxer === selectedDemuxer &&
          (fmt.codec === selectedCodec || (!fmt.codec && selectedCodec === 'UNKNOWN'))
        );

        const uniqueResolutions = [];
        const seenRes = new Set();
        availableFormats.forEach(fmt => {
            const resKey = fmt.label || `${fmt.width}x${fmt.height}`;
            if (!seenRes.has(resKey)) {
                seenRes.add(resKey);
                uniqueResolutions.push(fmt);
            }
        });

        uniqueResolutions.forEach((fmt) => {
          const opt = document.createElement('option');
          opt.value = fmt.label || `${fmt.width}x${fmt.height}`;
          let optLabel = fmt.label || `${fmt.width}x${fmt.height}`;
          if (fmt.contentLength) {
            optLabel += ` • ${getHumanReadableSize(fmt.contentLength)}`;
          }
          opt.textContent = optLabel;
          resSelect.appendChild(opt);
        });

        updateLanguageDropdown();
    }

    function updateLanguageDropdown() {
        // Save current selection to restore it later
        const previousLangVal = langSelect.value;
        const previousSubVal = subSelect.value;

        langSelect.innerHTML = '';
        const selectedDemuxer = formatSelect.value;
        const selectedCodec = codecSelect.value;
        const selectedRes = resSelect.value;

        const matchingFormats = ytFormats.filter(fmt =>
          fmt.demuxer === selectedDemuxer &&
          (fmt.codec === selectedCodec || (!fmt.codec && selectedCodec === 'UNKNOWN')) &&
          ((fmt.label || `${fmt.width}x${fmt.height}`) === selectedRes)
        );

        let showLangRow = false;

        if (matchingFormats.length > 1 || matchingFormats.some(f => f.audioTrack)) {
            langWrapper.style.display = 'block';
            showLangRow = true;

            const allOpt = document.createElement('option');
            allOpt.value = 'all';
            
            // Dinamis berdasarkan settings mux-all-audios
            browser.storage.local.get(['mux-all-audios']).then(res => {
                if (res['mux-all-audios'] === '1') {
                    allOpt.textContent = browser.i18n.getMessage("allLanguagesMux") || "All Languages (Embedded)";
                } else {
                    allOpt.textContent = browser.i18n.getMessage("allLanguagesZip") || "All Languages (ZIP)";
                }
            }).catch(() => {
                allOpt.textContent = browser.i18n.getMessage("allLanguagesZip") || "All Languages (ZIP)";
            });

            langSelect.appendChild(allOpt);

            matchingFormats.forEach(fmt => {
                const opt = document.createElement('option');
                opt.value = ytFormats.indexOf(fmt);
                opt.textContent = (fmt.audioTrack && fmt.audioTrack.display_name) ? fmt.audioTrack.display_name : "Original / Default";
                langSelect.appendChild(opt);
            });

            // Restore selection if it still exists
            if (previousLangVal && Array.from(langSelect.options).some(o => o.value === previousLangVal)) {
                langSelect.value = previousLangVal;
            }
        } else {
            langWrapper.style.display = 'none';
            if (matchingFormats[0]) {
                const opt = document.createElement('option');
                opt.value = ytFormats.indexOf(matchingFormats[0]);
                opt.textContent = "Default";
                langSelect.appendChild(opt);
            }
        }

        const ytSubtitles = item.ytSubtitles || null;
        if (ytSubtitles && ytSubtitles.length > 0) {
            subWrapper.style.display = 'block';
            showLangRow = true;
            if (subSelect.children.length === 0) {
                const noneOpt = document.createElement('option');
                noneOpt.value = 'none';
                noneOpt.textContent = browser.i18n.getMessage("noSubtitles") || "No Subtitles";
                subSelect.appendChild(noneOpt);

                const allSubOpt = document.createElement('option');
                allSubOpt.value = 'all';
                browser.storage.local.get(['embed-subtitles-mkv']).then(res => {
                    if (res['embed-subtitles-mkv'] === '1') {
                        allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesMux") || "All Subtitles (Embedded)";
                    } else {
                        allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesZip") || "All Subtitles (ZIP)";
                    }
                }).catch(() => {
                    allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesZip") || "All Subtitles (ZIP)";
                });
                subSelect.appendChild(allSubOpt);

                ytSubtitles.forEach(sub => {
                    const opt = document.createElement('option');
                    opt.value = sub.vttUrl;
                    opt.textContent = sub.displayName || sub.language;
                    subSelect.appendChild(opt);
                });
            } else {
                // Dynamically update the text of the "all" option if needed
                const allSubOpt = Array.from(subSelect.options).find(o => o.value === 'all');
                if (allSubOpt) {
                    browser.storage.local.get(['embed-subtitles-mkv']).then(res => {
                        if (res['embed-subtitles-mkv'] === '1') {
                            allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesMux") || "All Subtitles (Embedded)";
                        } else {
                            allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesZip") || "All Subtitles (ZIP)";
                        }
                    }).catch(() => {
                        allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesZip") || "All Subtitles (ZIP)";
                    });
                }
            }

            // Restore selection if it still exists
            if (previousSubVal && Array.from(subSelect.options).some(o => o.value === previousSubVal)) {
                subSelect.value = previousSubVal;
            }
        } else {
            subWrapper.style.display = 'none';
        }

        if (showLangRow) {
            langRow.style.display = 'flex';
        } else {
            langRow.style.display = 'none';
        }

        langSelect.dispatchEvent(new Event('change'));
    }


    formatSelect.addEventListener('change', updateCodecDropdown);
    codecSelect.addEventListener('change', updateResolutionDropdown);
    resSelect.addEventListener('change', updateLanguageDropdown);

    langSelect.addEventListener('change', () => {
      if (langSelect.value === '') return;

      if (langSelect.value === 'all') {
          const selectedDemuxer = formatSelect.value;
          const selectedCodec = codecSelect.value;
          const selectedRes = resSelect.value;
          const matchingFormats = ytFormats.filter(f =>
            f.demuxer === selectedDemuxer &&
            (f.codec === selectedCodec || (!f.codec && selectedCodec === 'UNKNOWN')) &&
            ((f.label || `${f.width}x${f.height}`) === selectedRes)
          );
          const firstFmt = matchingFormats[0];
          if (firstFmt) {
              activeUrl = firstFmt.videoUrl;
              activeAudioUrl = 'all';
              activeSize = firstFmt.contentLength || 'unknown';
              mediaDiv.dataset.url = activeUrl;
              mediaDiv.dataset.audioUrl = 'all';
              mediaDiv.dataset.size = activeSize;
              const newHumanSize = getHumanReadableSize(activeSize);
              const newResLabel = firstFmt.label ? ` • ${firstFmt.label}` : '';
              description.textContent = `${mediaURL.hostname} • ${newHumanSize}${newResLabel} • ${timeStr}`;
          }
          return;
      }

      const selectedIdx = parseInt(langSelect.value);
      const fmt = ytFormats[selectedIdx];
      if (fmt) {
        activeUrl = fmt.videoUrl;
        activeAudioUrl = fmt.audioUrl || null;
        activeSize = fmt.contentLength || 'unknown';
        mediaDiv.dataset.url = activeUrl;
        mediaDiv.dataset.audioUrl = activeAudioUrl || '';
        mediaDiv.dataset.size = activeSize;

        const newHumanSize = getHumanReadableSize(activeSize);
        const newResLabel = fmt.label ? ` • ${fmt.label}` : '';
        description.textContent = `${mediaURL.hostname} • ${newHumanSize}${newResLabel} • ${timeStr}`;
      }
    });

    formatWrapper.appendChild(formatSelect);
    resolutionRow.appendChild(formatWrapper);

    codecWrapper.appendChild(codecSelect);
    resolutionRow.appendChild(codecWrapper);

    resWrapper.appendChild(resSelect);
    resolutionRow.appendChild(resWrapper);

    actionsWrapper.appendChild(resolutionRow);
    actionsWrapper.appendChild(langRow);

    updateCodecDropdown();
  }

  const actions = document.createElement('div');
  actions.classList.add('media-actions');

  const buttonGroup = document.createElement('mdui-segmented-button-group');
  buttonGroup.style.width = '100%';

  const dlBtn = document.createElement('mdui-segmented-button');
  dlBtn.id = 'download-button';
  dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>${browser.i18n.getMessage("downloadButton") || "Download"}`;
  if (isSubtitle || isFile) dlBtn.style.borderRadius = '100px';
  dlBtn.addEventListener('click', () => {
    if (dlBtn.classList.contains('is-paused')) {
      const dlId = mediaDiv.dataset.downloadId;
      if (dlId) {
        browser.runtime.sendMessage({ action: 'resumeActiveDownload', id: dlId });
        updatePausePlayUI(dlBtn, false);
        if (window.activePauses) {
          window.activePauses.delete(dlId);
          if (activeUrl) window.activePauses.delete(activeUrl);
          if (activeAudioUrl) window.activePauses.delete(activeAudioUrl);
        }
      }
    } else if (dlBtn.classList.contains('is-playing')) {
      const dlId = mediaDiv.dataset.downloadId;
      if (dlId) {
        browser.runtime.sendMessage({ action: 'pauseDownload', id: dlId });
        updatePausePlayUI(dlBtn, true);
        if (window.activePauses) {
          window.activePauses.add(dlId);
          if (activeUrl) window.activePauses.add(activeUrl);
          if (activeAudioUrl) window.activePauses.add(activeAudioUrl);
        }
      }
    } else {
      const subSelect = mediaDiv.querySelector('.yt-subtitle-select');
      const activeSubtitleUrl = (subSelect && subSelect.value && subSelect.value !== 'none') ? subSelect.value : null;
      downloadFile(activeUrl, mediaDiv, activeSize, false, activeAudioUrl, activeSubtitleUrl);
    }
  });

  const prvBtn = document.createElement('mdui-segmented-button');
  prvBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="m380-300 280-180-280-180v360ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg></mdui-icon>${browser.i18n.getMessage("previewMedia") || "Preview"}`;
  if (isSubtitle || isFile) prvBtn.style.display = 'none';

  // hlsLarge is now declared in outer scope
  prvBtn.addEventListener('click', async () => {
      const isExpanded = mediaDiv.classList.toggle('expanded');

      if (isExpanded) {
        if (isImage) {
          largeVideo.style.display = 'none';
          let largeImg = inlinePreview.querySelector('img');
          if (!largeImg) {
            largeImg = document.createElement('img');
            largeImg.style.width = "100%";
            largeImg.style.height = "100%";
            largeImg.style.objectFit = "contain";
            inlinePreview.appendChild(largeImg);
          }
          largeImg.src = activeUrl;
          largeImg.style.display = 'block';
        } else {
          const largeImg = inlinePreview.querySelector('img');
          if (largeImg) largeImg.style.display = 'none';
          largeVideo.style.display = 'block';

          if (isStream) {
            await ensureScriptLoaded('libraries/hls.js', 'Hls');
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
              const finalUrl = await getPlayableUrl(activeUrl);
              hlsLarge = new Hls();
              hlsLarge.loadSource(finalUrl);
              hlsLarge.attachMedia(largeVideo);
              hlsLarge.on(Hls.Events.MANIFEST_PARSED, () => {
                updateHlsQuality(hlsLarge, mediaDiv.dataset.selectedResolution);
                largeVideo.play().catch(e => console.warn("Auto-play failed:", e));
              });
            } else if (largeVideo.canPlayType('application/vnd.apple.mpegurl')) {
              const finalUrl = await getPlayableUrl(activeUrl);
              largeVideo.src = finalUrl;
              largeVideo.play().catch(e => console.warn("Auto-play failed:", e));
            }
          } else {
            largeVideo.src = activeUrl;
            largeVideo.play().catch(e => console.warn("Auto-play failed:", e));
          }
        }
        prvBtn.setAttribute('selected', '');
      } else {
        largeVideo.pause();
        largeVideo.src = "";
        const largeImg = inlinePreview.querySelector('img');
        if (largeImg) largeImg.src = "";

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
    if (activeAudioUrl) {
        downloadAudioOnly(activeAudioUrl, mediaDiv, activeSize);
    } else {
        downloadAudioOnly(activeUrl, mediaDiv, activeSize);
    }
  });
  if (!isVideo && !isStream) audioBtn.style.display = 'none';

  const cancelBtn = document.createElement('mdui-segmented-button');
  cancelBtn.id = 'cancel-button';
  cancelBtn.style.display = 'none';
  cancelBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></mdui-icon>${browser.i18n.getMessage("cancelButton") || "Cancel"}`;

  cancelBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const dlId = mediaDiv.dataset.downloadId;
    window.activeCancellations.add(activeUrl);
    if (window.activeAbortControllers.has(activeUrl)) {
      window.activeAbortControllers.get(activeUrl).abort();
    }
    if (activeAudioUrl) {
      window.activeCancellations.add(activeAudioUrl);
      if (window.activeAbortControllers.has(activeAudioUrl)) {
        window.activeAbortControllers.get(activeAudioUrl).abort();
      }
    }
    if (dlId) {
      window.activeCancellations.add(dlId);
      if (window.activePauses) window.activePauses.delete(dlId);
    }
    if (window.activePauses) {
      window.activePauses.delete(activeUrl);
      if (activeAudioUrl) window.activePauses.delete(activeAudioUrl);
    }
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
        browser.tabs.sendMessage(activeTab.id, { action: 'cancelDownload', url: activeUrl }).catch(() => {});
        if (activeAudioUrl) {
          browser.tabs.sendMessage(activeTab.id, { action: 'cancelDownload', url: activeAudioUrl }).catch(() => {});
        }
      }
    } catch(e) {}
    browser.runtime.sendMessage({ action: 'cancelDownload', url: activeUrl, id: dlId });
    if (activeAudioUrl) {
      browser.runtime.sendMessage({ action: 'cancelDownload', url: activeAudioUrl, id: dlId });
    }
    finishDownloadUI(dlId || activeUrl, false);
  });
  dlBtn.style.flex = '1.0';
  buttonGroup.appendChild(dlBtn);

  if (isVideo || isStream) {
    audioBtn.style.flex = '1';
    buttonGroup.appendChild(audioBtn);
  }

  cancelBtn.style.flex = '1';
  buttonGroup.appendChild(cancelBtn);

  if (!(isSubtitle || isFile)) {
    prvBtn.style.flex = '1';
    buttonGroup.appendChild(prvBtn);
  }

  actions.appendChild(buttonGroup);
  actionsWrapper.appendChild(actions);
  mediaDiv.appendChild(actionsWrapper);

  uiCache.set(bestRequest.originalUrl, { element: mediaDiv, dlBtn, audioBtn, prvBtn, cancelBtn });

  return mediaDiv;
}

function updatePausePlayUI(btn, isPaused) {
  if (isPaused) {
    btn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></mdui-icon>${browser.i18n.getMessage("resumeActiveButton") || "Resume"}`;
    btn.classList.add('is-paused');
    btn.classList.remove('is-playing');
  } else {
    btn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></mdui-icon>${browser.i18n.getMessage("pauseButton") || "Pause"}`;
    btn.classList.add('is-playing');
    btn.classList.remove('is-paused');
  }
}

function getMediaType(url, responseHeaders) {
    if (!url) return null;
    const urlLower = url.toLowerCase();

    let contentType = "";
    if (responseHeaders && Array.isArray(responseHeaders)) {
        const found = responseHeaders.find(h => h.name && h.name.toLowerCase() === "content-type");
        if (found && found.value) {
            contentType = found.value.toLowerCase();
        }
    }

    if (urlLower.startsWith('chrome-extension://') ||
        urlLower.startsWith('moz-extension://') ||
        urlLower.startsWith('blob:chrome-extension://') ||
        urlLower.startsWith('blob:moz-extension://')) {
        return null;
    }

    if (contentType.startsWith('video/') || urlLower.includes('mime=video') || urlLower.includes('#video')) return 'video';
    if (contentType.startsWith('audio/') || urlLower.includes('mime=audio') || urlLower.includes('#audio')) return 'audio';

    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"];
    const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif"];
    const downloadExtensions = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

    const urlPath = urlLower.split('?')[0].split('#')[0];
    const hasExt = (ext) => urlPath.endsWith(ext) || urlLower.includes(ext + '&') || urlLower.includes(ext + '?') || urlLower.includes(ext + '#') || urlLower.endsWith(ext);

    if (videoExtensions.some(hasExt)) return 'video';
    if (audioExtensions.some(hasExt)) return 'audio';

    if (contentType === 'image/svg+xml' || hasExt('.svg')) return null;
    if (contentType.startsWith('image/') || imageExtensions.some(hasExt) || urlLower.includes('#image')) return 'image';

    if (streamExtensions.some(hasExt) || contentType.includes('mpegurl') || contentType.includes('dash+xml') || urlLower.includes('#stream')) return 'stream';
    if (subtitleExtensions.some(hasExt) || contentType.includes('vtt') || contentType.includes('subrip') || contentType.includes('ass') || contentType.includes('ttml') || contentType.includes('dfxp') || contentType.includes('sami') || contentType.includes('smil') || contentType.includes('lrc') || contentType.includes('sbv') || contentType.includes('microdvd') || urlLower.includes('#subtitle')) return 'subtitle';

    if (downloadExtensions.some(hasExt) || urlLower.includes('#file')) return 'file';

    return null;
}

function checkIsSegment(url, responseHeaders, settings) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    const contentType = responseHeaders?.find(h => h.name.toLowerCase() === "content-type")?.value?.toLowerCase() || "";
    const contentLength = responseHeaders?.find(h => h.name.toLowerCase() === "content-length")?.value || "0";
    const size = parseInt(contentLength) || 0;

    const isHideSegments = settings ? isFlagEnabled(settings['hide-segments']) : true;
    const isHidePageComponents = isHideSegments;

    const path = urlLower.split('?')[0].split('#')[0];
    if (isHidePageComponents && (
        path.endsWith('.html') || path.endsWith('.htm') ||
        path.endsWith('.css') ||
        path.endsWith('.js') ||
        path.endsWith('.txt') ||
        path.endsWith('.ico') ||
        path.endsWith('.webmanifest') || path.endsWith('manifest.json') ||
        path.endsWith('.jpg') || path.endsWith('.jpeg') ||
        path.endsWith('.webp') ||
        path.endsWith('.png'))) {

        if (settings && settings['only-image'] === '1' && (path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.webp') || path.endsWith('.png'))) {
            return false;
        }
        return true;
    }

    if (!isHideSegments) return false;

    if (path.endsWith('.ts') ||
        path.endsWith('.m4s') ||
        path.endsWith('.m4v') ||
        path.endsWith('.m4a') ||
        path.endsWith('.m2ts') ||
        path.endsWith('.mts')) {
        return true;
    }

    if (contentType === 'video/mp2t' ||
        contentType === 'video/iso.segment' ||
        contentType === 'audio/iso.segment') {
        return true;
    }

    if (size > 0 && size < 5242880) {
        if (urlLower.includes('chunk') ||
            urlLower.includes('fragment') ||
            urlLower.includes('segment') ||
            urlLower.includes('range/')) {
            return true;
        }
    }

    return false;
}

async function loadMediaList() {
  const mediaContainer = document.getElementById('media-list');
  const loadingSpinner = document.getElementById('loading-media-list');
  const globalLoading = document.getElementById('loading');
  const mainContent = document.getElementById('main-content');
  const mediaControls = document.getElementById('media-controls');

  const urlParams = new URLSearchParams(window.location.search);
  const autoAudioUrl = urlParams.get('autoDownloadAudioUrl');
  const autoVideoUrl = urlParams.get('autoDownloadVideoUrl');
  const autoOpenUrl = urlParams.get('autoOpenUrl');
  const autoDemuxer = urlParams.get('autoDemuxer') || '';
  const autoCodec = urlParams.get('autoCodec') || '';

  if (autoAudioUrl || autoVideoUrl || autoOpenUrl) {
    const cleanUrl = window.location.pathname + (window.location.search.includes('mode=tab') ? '?mode=tab' : '');
    window.history.replaceState({}, document.title, cleanUrl);
  }

  let activeTabTitle = "";
  const tabIdToTitle = new Map();
  try {
    const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs[0];
    if (activeTab && activeTab.title && !activeTab.url.startsWith('chrome-extension://') && !activeTab.url.startsWith('moz-extension://') && !activeTab.url.startsWith('about:')) {
      activeTabTitle = activeTab.title;
    }

    const allTabs = await browser.tabs.query({});
    allTabs.forEach(t => {
      if (t.id && t.title && t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('moz-extension://') && !t.url.startsWith('about:')) {
        tabIdToTitle.set(t.id, t.title);
      }
    });
  } catch (e) {}
  if (mainContent) mainContent.style.display = 'block';
  if (loadingSpinner) loadingSpinner.style.display = 'block';

  document.getElementById('search-bar').value = '';
  document.getElementById('select-all-checkbox').checked = false;
  selectedUrls.clear();
  updateSelectedCount();

  const activeItems = new Map();
  mediaContainer.querySelectorAll('.media-item').forEach(item => {
    if (item.querySelector('mdui-linear-progress')) {
      activeItems.set(item.dataset.url, item);
    }
  });

  mediaContainer.innerHTML = '';
  activeItems.forEach(item => mediaContainer.appendChild(item));

  try {
    const mediaRequests = await browser.runtime.sendMessage({ action: 'getMediaRequests' });
    if (globalLoading) globalLoading.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';

    if (!mediaRequests || Object.keys(mediaRequests).length === 0) {
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        const backgroundDownloads = await browser.runtime.sendMessage({ action: 'getActiveDownloads' }).catch(() => null);
        const activeEntries = Object.entries(backgroundDownloads || {});
        if (activeEntries.length > 0) {
          mediaContainer.innerHTML = '';
          activeDownloadingElements = [];
          downloadingCount = 0;
          for (const [id, downloadData] of activeEntries) {
            if (downloadData.isZip) continue;
            const type = downloadData.mediaType || 'file';
            const mockItem = {
              bestRequest: {
                originalUrl: downloadData.url || '',
                size: downloadData.total,
                filename: downloadData.filename,
                timeStamp: Date.now()
              },
              type,
              isVideo: type === 'video', isAudio: type === 'audio', isStream: type === 'stream',
              isSubtitle: type === 'subtitle', isImage: type === 'image', isFile: type === 'file'
            };
            const item = createMediaItem(mockItem);
            item.dataset.downloadId = id;
            if (downloadData.url) item.dataset.url = downloadData.url;
            mediaContainer.appendChild(item);
            activeDownloadingElements.push(item);
            updateDownloadingCount(1);
          }
          if (mediaControls) mediaControls.style.display = 'flex';
          allMediaRequests = [];
          allFilteredRequests = [];
          await restoreActiveDownloadsUI(backgroundDownloads);
          return;
        }
        if (activeItems.size === 0) {
          mediaContainer.innerHTML = getNoMediaDetectedHTML();
          if (mediaControls) mediaControls.style.display = 'none';
        } else {
          if (mediaControls) mediaControls.style.display = 'flex';
        }
        allMediaRequests = [];
        allFilteredRequests = [];
        return;
    }

    const settings = await browser.storage.local.get(['filename-template', 'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file', 'hide-segments', 'hide-page-components', 'media-sort-order', 'limit-media-list', 'limit-media-list-custom', 'min-file-size', 'min-file-size-custom', 'optimize-low-end', 'group-by-type', 'disable-deduplication']);
    isGroupingEnabled = settings['group-by-type'] === undefined || settings['group-by-type'] === '1' || settings['group-by-type'] === true;

    const minFileSizeSetting = settings['min-file-size'] || '0';
    let minSizeBytes = 0;
    if (minFileSizeSetting === 'custom') {
      const customKB = parseInt(settings['min-file-size-custom']) || 0;
      minSizeBytes = customKB * 1024;
    } else {
      minSizeBytes = (parseInt(minFileSizeSetting) || 0) * 1024;
    }

    if (isGroupingEnabled) {
      if (autoAudioUrl) {
        const decodedUrl = decodeURIComponent(autoAudioUrl);
        const isYouTube = decodedUrl.includes('googlevideo.com') || decodedUrl.includes('youtube.com') || decodedUrl.includes('youtu.be');
        activeGroup = isYouTube ? 'video' : 'audio';
      } else if (autoVideoUrl) {
        activeGroup = 'video';
      } else if (autoOpenUrl) {
        const decodedUrl = decodeURIComponent(autoOpenUrl);
        const isYouTube = decodedUrl.includes('googlevideo.com') || decodedUrl.includes('youtube.com') || decodedUrl.includes('youtu.be');
        if (isYouTube) {
          activeGroup = 'video';
        } else {
          const type = getMediaType(decodedUrl);
          if (type) {
            activeGroup = type;
          }
        }
      }
    }

    const mediaGroups = new Map();
    for (const rawUrl in mediaRequests) {
      if (activeItems.has(rawUrl)) continue;

      const requests = mediaRequests[rawUrl];
      if (!Array.isArray(requests) || requests.length === 0) continue;

      const lastResponseHeaders = requests[requests.length - 1].responseHeaders;
      if (checkIsSegment(rawUrl, lastResponseHeaders, settings)) continue;

      let type = getMediaType(rawUrl, lastResponseHeaders);
      const isManualItem = requests.some(r => r.isManual);
      if (!type && isManualItem) {
          type = 'file';
      }
      if (!type) continue;

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
        const reqSize = parseInt(requests[requests.length - 1].size) || 0;
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

    const streamGroups = [];
    mediaGroups.forEach(group => {
        const bestRequest = group.requests[0];
        if (bestRequest) {
            const urlLower = (bestRequest.originalUrl || bestRequest.url || "").toLowerCase();
            const isStreamUrl = urlLower.includes('.m3u8') || urlLower.includes('.mpd');
            if (isStreamUrl) {
                streamGroups.push({ url: bestRequest.originalUrl || bestRequest.url });
            }
        }
    });

    const urlVariantsMap = new Map();
    try {
        const variantsResults = await Promise.all(
            streamGroups.map(async (item) => {
                try {
                    const isMPD = item.url.toLowerCase().includes('.mpd');
                    const variants = isMPD ? await getMPDVariants(item.url) : await getM3U8Variants(item.url);
                    return { url: item.url, variants };
                } catch (e) {
                    return { url: item.url, variants: [] };
                }
            })
        );
        variantsResults.forEach(res => {
            urlVariantsMap.set(res.url, res.variants);
        });
    } catch (e) {
        console.warn("Failed to fetch stream variants in parallel:", e);
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
            const variants = urlVariantsMap.get(bestRequest.originalUrl || bestRequest.url) || [];
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
    flattenedRequests.sort((a, b) => {
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
      limit = 0;
    }
    if (limit > 0 && flattenedRequests.length > limit) {
      flattenedRequests.length = limit;
    }

    allMediaRequests = flattenedRequests;
    allFilteredRequests = [...allMediaRequests];

    if (loadingSpinner) loadingSpinner.style.display = 'none';

    let activeDownloads = {};
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
        const tabDownloads = await browser.tabs.sendMessage(activeTab.id, { action: 'get_active_downloads' }).catch(() => null);
        if (tabDownloads) {
          activeDownloads = tabDownloads;
        }
      }
    } catch (e) {
      console.warn("Failed to get active downloads from tab:", e);
    }
    const bgDownloads = await browser.runtime.sendMessage({ action: 'getActiveDownloads' }).catch(() => null);
    if (bgDownloads) {
      activeDownloads = { ...activeDownloads, ...bgDownloads };
    }

    activeDownloadingElements = [];
    if (activeDownloads) {
      const activeIds = Object.keys(activeDownloads);
      downloadingCount = 0;

      activeIds.forEach(id => {
        const downloadData = activeDownloads[id];
        const url = downloadData.url;
        if (downloadData.isZip) return;
        updateDownloadingCount(1);

        const hasInRequests = allFilteredRequests.some(item => {
          const itemUrl = item.bestRequest.originalUrl;
          return itemUrl === url || (url && itemUrl && url.split('?')[0] === itemUrl.split('?')[0]);
        });

        if (!hasInRequests) {
          const type = downloadData.mediaType || 'file';
          const mockItem = {
            bestRequest: { originalUrl: url || '', size: downloadData.total, timeStamp: Date.now() },
            type: type,
            isVideo: type === 'video', isAudio: type === 'audio', isStream: type === 'stream',
            isSubtitle: type === 'subtitle', isImage: type === 'image', isFile: type === 'file'
          };

          const mediaContainer = document.getElementById('media-list');
          const item = createMediaItem(mockItem);
          item.dataset.downloadId = id;
          if (url) item.dataset.url = url;
          mediaContainer.appendChild(item);

          if (!activeDownloadingElements.includes(item)) {
            activeDownloadingElements.push(item);
          }
        }
      });
    }

    renderInitialList();

    if (autoAudioUrl) {
      const decodedUrl = decodeURIComponent(autoAudioUrl);
      setTimeout(() => {
        const allItems = Array.from(document.querySelectorAll('.media-item'));
        let mediaItemEl = allItems.find(el => {
          const elUrl = el.dataset.url;
          return elUrl === decodedUrl || (elUrl && elUrl.split('?')[0] === decodedUrl.split('?')[0]);
        });
        if (!mediaItemEl) {
          mediaItemEl = allItems.find(el => {
            if (el.ytFormats) {
              return el.ytFormats.some(f => {
                if (f.videoUrl === decodedUrl || f.audioUrl === decodedUrl) return true;
                const getItag = (u) => u ? u.match(/[?&]itag=(\d+)/)?.[1] : null;
                const itagFmtVid = getItag(f.videoUrl);
                const itagFmtAud = getItag(f.audioUrl);
                const itagDec = getItag(decodedUrl);
                if (itagDec && (itagDec === itagFmtVid || itagDec === itagFmtAud)) return true;
                return false;
              });
            }
            return false;
          });
        }
        if (mediaItemEl) {
          const audioBtn = mediaItemEl.querySelector('#audio-only-button');
          if (audioBtn && audioBtn.style.display !== 'none') {
            audioBtn.click();
          } else {
            const dlBtn = mediaItemEl.querySelector('#download-button');
            if (dlBtn) dlBtn.click();
          }
        }
      }, 300);
    } else if (autoVideoUrl) {
      const decodedUrl = decodeURIComponent(autoVideoUrl);
      let attempts = 0;
      const tryAutoDownload = () => {
        attempts++;
        // Find any media item that has yt-format/yt-codec/yt-resolution selectors (YouTube item)
        // or match by URL
        const allItems = Array.from(document.querySelectorAll('.media-item'));
        let mediaItemEl = allItems.find(el => {
          const elUrl = el.dataset.url;
          return elUrl === decodedUrl || (elUrl && elUrl.split('?')[0] === decodedUrl.split('?')[0]);
        });
        // If no direct match, try finding by YouTube format selectors — the dataset.url may be for a different resolution
        if (!mediaItemEl) {
          mediaItemEl = allItems.find(el => {
            const fmtSel = el.querySelector('.yt-format-select');
            const resSel = el.querySelector('.yt-resolution-select');
            if (!fmtSel || !resSel) return false;
            // Check if any resolution option's videoUrl matches
            for (const opt of resSel.options) {
              const idx = parseInt(opt.value);
              if (!isNaN(idx)) return true; // Has YT formats, likely the right item
            }
            return false;
          });
        }
        if (mediaItemEl) {
          const fmtSel = mediaItemEl.querySelector('.yt-format-select');
          const codecSel = mediaItemEl.querySelector('.yt-codec-select');
          const resSel = mediaItemEl.querySelector('.yt-resolution-select');
          const dlBtn = mediaItemEl.querySelector('#download-button');
          if (dlBtn && fmtSel && codecSel && resSel) {
            // Set format (demuxer)
            if (autoDemuxer) {
              for (const opt of fmtSel.options) {
                if (opt.value === autoDemuxer) {
                  fmtSel.value = autoDemuxer;
                  fmtSel.dispatchEvent(new Event('change'));
                  break;
                }
              }
            }
            // Set codec
            if (autoCodec) {
              // Wait a tick for codec dropdown to populate after format change
              setTimeout(() => {
                for (const opt of codecSel.options) {
                  if (opt.value === autoCodec) {
                    codecSel.value = autoCodec;
                    codecSel.dispatchEvent(new Event('change'));
                    break;
                  }
                }
                // Wait for resolution dropdown to populate, then find matching videoUrl
                setTimeout(() => {
                  const ytFormats = mediaItemEl.ytFormats;
                  let foundOptValue = null;
                  if (ytFormats) {
                    for (const opt of resSel.options) {
                      const idx = parseInt(opt.value);
                      if (!isNaN(idx)) {
                        const optionFmt = ytFormats[idx];
                        if (optionFmt) {
                          const getItag = (u) => u.match(/[?&]itag=(\d+)/)?.[1];
                          const itagOpt = getItag(optionFmt.videoUrl);
                          const itagDec = getItag(decodedUrl);

                          if (optionFmt.videoUrl === decodedUrl || (itagOpt && itagOpt === itagDec)) {
                            foundOptValue = opt.value;
                            break;
                          }
                        }
                      }
                    }
                  }

                  if (foundOptValue !== null) {
                    resSel.value = foundOptValue;
                    resSel.dispatchEvent(new Event('change'));
                  }

                  mediaItemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  setTimeout(() => dlBtn.click(), 200);
                }, 50);
              }, 50);
            } else {
              mediaItemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => dlBtn.click(), 200);
            }
            return;
          }
        }
        if (attempts < 20) {
          setTimeout(tryAutoDownload, 300);
        }
      };
      setTimeout(tryAutoDownload, 500);
    }
    } catch (err) {
    console.error("Error loading media list:", err);
    if (globalLoading) globalLoading.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
    if (loadingSpinner) loadingSpinner.style.display = 'none';
  }
}

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
          mdui.snackbar({ message: browser.i18n.getMessage("copyURLSuccess") || "URL copied to clipboard", placement: "top" });
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
          mdui.snackbar({
            message: browser.i18n.getMessage("historyRefreshInstruction") || "Please play the video to refresh the link",
            placement: "top"
          });
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
            mdui.snackbar({ message: browser.i18n.getMessage("downloadStartedSnackbar") || "Download started...", placement: "top" });
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
      mdui.snackbar({ message: browser.i18n.getMessage('historyImportSuccess') || 'History imported successfully!', placement: 'top' });
    }
  } catch (err) {
    if (typeof mdui !== 'undefined' && mdui.snackbar) {
      mdui.snackbar({ message: browser.i18n.getMessage('historyImportError', [err.message]) || `Failed to import history: ${err.message}`, placement: 'top' });
    }
  }
}

async function loadAboutPage() {
  const container = document.getElementById('about-container');
  try {
    const response = await fetch(browser.runtime.getURL('about.json?t=' + Date.now()));
    const data = await response.json();

    const isFirefox = navigator.userAgent.includes('Firefox') || (typeof browser !== 'undefined' && browser.runtime.getURL && browser.runtime.getURL('').startsWith('moz-extension://'));
    const reinstallUrl = isFirefox 
      ? 'https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader/'
      : `https://github.com/anpa26/website-media-downloader/releases/tag/v${browser.runtime.getManifest().version}`;

    let requireUninstall = false;
    let hasDismissedWarning = false;
    let reinstallDescription = '';
    try {
      const [changelogRes, storageData] = await Promise.all([
        fetch(browser.runtime.getURL('changelog.json')),
        browser.storage.local.get('wmd_reinstall_about_dismissed')
      ]);
      const changelogData = await changelogRes.json();
      requireUninstall = !!changelogData.require_uninstall;
      const changelogLang = browser.i18n.getUILanguage().split('-')[0];
      const changelogContent = changelogData[changelogLang] || changelogData.en;
      reinstallDescription = changelogContent?.reinstall_description || '';
      hasDismissedWarning = storageData.wmd_reinstall_about_dismissed === '1';
    } catch (e) {
      console.warn("Failed to read settings in About:", e);
    }

    let reinstallCardHtml = '';
    if (requireUninstall && !hasDismissedWarning) {
      reinstallCardHtml = `
        <div style="display: flex; flex-direction: column; gap: 8px; padding: 18px 16px 12px; background: rgba(var(--mdui-color-error), 0.05); border-radius: var(--app-border-radius); border: 1px solid rgba(var(--mdui-color-error), 0.15); margin-top: 4px;">
          <div style="font-size: 0.85rem; font-weight: 700; color: rgb(var(--mdui-color-error)); display: flex; align-items: center; gap: 6px;">
            <mdui-icon style="font-size: 16px;"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></mdui-icon>
            ${browser.i18n.getMessage("reinstallTitle") || "Reinstallation Recommended"}
          </div>
          <p style="font-size: 0.78rem; line-height: 1.5; margin: 4px 0 8px; color: var(--on-surface-variant);">
            ${reinstallDescription}
          </p>
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <mdui-button id="about-confirm-reinstalled" style="--mdui-shape-corner-extra-small: 16px; height: 32px; font-size: 12px; background: rgba(var(--mdui-color-primary), 0.1); color: var(--primary);">
              ${browser.i18n.getMessage("confirmReinstalledBtn") || "Sudah Reinstall"}
            </mdui-button>
            <a href="${reinstallUrl}" target="_blank" style="text-decoration: none;">
              <mdui-button style="--mdui-shape-corner-extra-small: 16px; height: 32px; font-size: 12px; background: rgb(var(--mdui-color-error)); color: white;">
                <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></mdui-icon>
                ${browser.i18n.getMessage("reinstallActionBtn") || "Buka Toko"}
              </mdui-button>
            </a>
          </div>
        </div>
      `;
    }

    let trustedSourcesHtml = '';
    if (isFirefox) {
      trustedSourcesHtml = `
        <div style="display: flex; gap: 8px;">
          <a href="https://github.com/anpa26/website-media-downloader/releases" target="_blank" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; color: var(--primary); font-size: 0.75rem; font-weight: 600; padding: 8px 12px; background: rgba(var(--mdui-color-primary), 0.08); border: 1px solid rgba(var(--mdui-color-primary), 0.15); border-radius: 12px; transition: background 0.2s;">
            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: currentColor; flex-shrink: 0;"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            GitHub Release
          </a>
          <a href="https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader/" target="_blank" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; color: var(--primary); font-size: 0.75rem; font-weight: 600; padding: 8px 12px; background: rgba(var(--mdui-color-primary), 0.08); border: 1px solid rgba(var(--mdui-color-primary), 0.15); border-radius: 12px; transition: background 0.2s;">
            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: #FF7139; flex-shrink: 0;"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 7.312c.459.63.784 1.353.957 2.118-.495-.302-1.177-.46-1.957-.46-.948 0-1.74.268-2.269.705.025-.21.038-.426.038-.645 0-1.696-.647-3.24-1.698-4.401.977.175 1.889.578 2.646 1.165.108.08.214.163.317.249.001.001.002.001.003.002.013.012.026.022.039.033.08.072.158.146.234.222a6.01 6.01 0 0 1 1.69 1.012zm-9.905 2.118c.173-.765.498-1.488.957-2.118a6.01 6.01 0 0 1 1.69-1.012c.076-.076.154-.15.234-.222.013-.011.026-.021.039-.033.001-.001.002-.001.003-.002.103-.086.209-.169.317-.249a5.974 5.974 0 0 1 2.646-1.165C12.493 5.91 11.846 7.454 11.846 9.15c0 .219.013.435.038.645-.529-.437-1.321-.705-2.269-.705-.78 0-1.462.158-1.957.46zm4.343 9.327a3.966 3.966 0 0 1-3.963-3.963c0-2.188 1.776-3.963 3.963-3.963s3.963 1.775 3.963 3.963a3.967 3.967 0 0 1-3.963 3.963z"/></svg>
            Firefox Add-on
          </a>
        </div>
      `;
    } else {
      trustedSourcesHtml = `
        <div style="display: flex; gap: 8px;">
          <a href="https://github.com/anpa26/website-media-downloader/releases" target="_blank" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; color: var(--primary); font-size: 0.75rem; font-weight: 600; padding: 8px 12px; background: rgba(var(--mdui-color-primary), 0.08); border: 1px solid rgba(var(--mdui-color-primary), 0.15); border-radius: 12px; transition: background 0.2s;">
            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: currentColor; flex-shrink: 0;"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            GitHub Release
          </a>
        </div>
      `;
    }

    let html = `
      <div class="about-content" style="padding: 16px; display: flex; flex-direction: column; gap: 24px;">
        <div style="text-align: center; padding: 24px 16px; background: var(--surface-low); border-radius: var(--app-border-radius); border: 1px solid rgb(var(--mdui-color-outline-variant));">
          <div style="width: 48px; height: 48px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
            <img src="${browser.runtime.getURL('icons/icon.png')}" style="width: 48px; height: 48px; object-fit: contain;">
          </div>
          <h1 style="margin: 0; font-size: 1.4rem; font-weight: 700; color: rgb(var(--mdui-color-on-surface));">${data.extension.name}</h1>
          <p style="font-size: 0.9rem; line-height: 1.6; margin: 16px 0 0; color: var(--on-surface-variant);">${browser.i18n.getMessage("extensionDescriptionAbout") || data.extension.description}</p>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: var(--surface-low); border-radius: var(--app-border-radius); border: 1px solid rgb(var(--mdui-color-outline-variant));">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--on-surface-variant); padding-left: 4px;">
              ${browser.i18n.getMessage("installedVersion") || "Version"} ${browser.runtime.getManifest().version}
            </div>
            <mdui-button id="manual-check-update" style="--mdui-shape-corner-extra-small: 16px; height: 32px; font-size: 12px; background: linear-gradient(135deg, rgba(var(--mdui-color-primary), 0.15), rgba(var(--mdui-color-on-surface), 0.08)); backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%); box-shadow: inset 2px 2px 4px rgba(0, 0, 0, 0.1), inset -2px -2px 4px rgba(255, 255, 255, 0.05); border: 1px solid rgba(var(--mdui-color-primary), 0.15); color: var(--primary);">
              <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></mdui-icon>
              ${browser.i18n.getMessage("checkUpdateButton") || "Check for Updates"}
            </mdui-button>
          </div>
          <div id="update-status-text" style="font-size: 0.75rem; font-weight: 500; text-align: center; display: none; color: var(--on-surface-variant); border-top: 1px solid rgba(var(--mdui-color-outline-variant), 0.5); margin-top: 4px; padding-top: 8px;"></div>
        </div>
        ${reinstallCardHtml}

        <div style="padding: 12px 16px; background: var(--surface-low); border-radius: var(--app-border-radius); border: 1px solid rgb(var(--mdui-color-outline-variant));">
          <div style="font-size: 0.75rem; font-weight: 700; text-transform: none; letter-spacing: 0.02em; color: var(--on-surface-variant); margin-bottom: 8px;">${browser.i18n.getMessage('trustedUpdateSourcesTitle') || 'Trusted Update Sources'}</div>
          ${trustedSourcesHtml}
          <a href="https://wmd.devianproject.tech/download" target="_blank" style="margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; color: var(--primary); font-size: 0.75rem; font-weight: 600; padding: 8px 12px; background: rgba(var(--mdui-color-primary), 0.08); border: 1px solid rgba(var(--mdui-color-primary), 0.15); border-radius: 12px; transition: background 0.2s;">
            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: currentColor; flex-shrink: 0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
            WMD Official Web
          </a>
        </div>
      `;

    html += `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <h2 style="font-size: 0.9rem; font-weight: 700; text-transform: none; letter-spacing: 0.02em; color: var(--primary); margin: 0 8px;">${browser.i18n.getMessage("maintainedByTitle") || "Maintained By"}</h2>
    `;

    const lead = data.authors[0];
    html += `
        <mdui-card variant="filled" style="padding: 20px !important; background: linear-gradient(135deg, rgba(var(--mdui-color-primary), 0.1), rgba(var(--mdui-color-on-surface), 0.05)); backdrop-filter: blur(30px) saturate(160%); -webkit-backdrop-filter: blur(30px) saturate(160%); box-shadow: inset 4px 4px 8px rgba(0, 0, 0, 0.1), inset -4px -4px 8px rgba(255, 255, 255, 0.03); border: 1px solid rgba(var(--mdui-color-primary), 0.12); overflow: visible; border-radius: 24px;">
          <div style="display: flex; gap: 16px; align-items: center; position: relative;">
            <mdui-avatar src="${lead.avatar}" style="width: 56px; height: 56px; border: 2px solid rgba(255,255,255,0.1); box-shadow: 0 4px 12px rgba(0,0,0,0.15);"></mdui-avatar>
            <div style="flex-grow: 1;">
              <b style="font-size: 1.1rem; color: var(--primary);">${lead.name}</b>
              <p style="margin: 8px 0 0; font-size: 0.85rem; line-height: 1.5; color: var(--on-surface-variant);">${browser.i18n.getMessage("leadDeveloperDescription") || lead.description}</p>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; align-self: stretch; justify-content: center; min-width: 80px;">
              <span style="font-size: 0.65rem; color: var(--primary); opacity: 0.8; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; position: absolute; top: -4px; right: 0;">${browser.i18n.getMessage("leadDeveloperRole") || lead.role}</span>
              <mdui-button-icon variant="filled" style="--mdui-color-primary: var(--primary); --mdui-color-on-primary: var(--surface-low); flex-shrink: 0;" href="${lead.github}" target="_blank">
                <svg viewBox="0 0 24 24" style="fill: currentColor;"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
              </mdui-button-icon>
            </div>
          </div>
        </mdui-card>
    `;

    if (data.authors.length > 1) {
      html += `
        <h2 style="font-size: 0.75rem; font-weight: 700; text-transform: none; letter-spacing: 0.02em; color: var(--on-surface-variant); margin: 12px 8px 0;">${browser.i18n.getMessage("legacyContributionsTitle") || "Legacy Contributions"}</h2>
        <mdui-list style="background: transparent;">
      `;

      data.authors.slice(1).forEach((author) => {
        html += `
          <mdui-list-item nonclickable style="border-radius: 12px; margin-bottom: 4px;">
            <mdui-avatar slot="icon" src="${author.avatar}" style="width: 32px; height: 32px;"></mdui-avatar>
            <div style="font-weight: 600; font-size: 0.9rem;">${author.name}</div>
            <div slot="description" style="font-size: 0.8rem; opacity: 0.7;">${browser.i18n.getMessage("legacyContributorDescription") || author.description}</div>
            <span slot="description" style="font-size: 0.7rem; font-weight: 700; color: var(--primary); text-transform: uppercase; margin-top: 4px; display: block;">${browser.i18n.getMessage("legacyContributorRole") || author.role}</span>
            <mdui-button-icon slot="end-icon" href="${author.github}" target="_blank">
              <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            </mdui-button-icon>
          </mdui-list-item>
        `;
      });

      html += `</mdui-list>`;
    }

    html += `
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <h2 style="font-size: 0.75rem; font-weight: 700; text-transform: none; letter-spacing: 0.02em; color: var(--primary); margin: 8px 8px 0;">${browser.i18n.getMessage("usefulLinksTitle") || "Useful Links"}</h2>
    `;

    const linkTranslationMap = {
      "Official Website": "officialWebsite",
      "Star on GitHub": "starOnGithub",
      "Rate on Add-ons": "rateOnAddons",
      "GitHub Repository": "githubRepositoryLabel",
      "Report Issue": "reportIssue"
    };

    const officialLink = data.links.find(l => l.label === "Official Website");
    const otherLinks = data.links.filter(l => l.label !== "Official Website");

    if (officialLink) {
      const transKey = linkTranslationMap[officialLink.label];
      const localizedLabel = transKey ? (browser.i18n.getMessage(transKey) || officialLink.label) : officialLink.label;
      html += `
        <mdui-card href="${officialLink.url}" target="_blank" clickable style="background: linear-gradient(135deg, rgba(var(--mdui-color-primary), 0.15), rgba(var(--mdui-color-primary), 0.05)); border: 1px solid rgba(var(--mdui-color-primary), 0.3); border-radius: 14px; transition: var(--transition); width: 100%; box-sizing: border-box;">
          <div style="padding: 14px 16px; display: flex; align-items: center; gap: 14px; box-sizing: border-box; width: 100%;">
            <div style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: rgba(var(--mdui-color-primary), 0.15); color: var(--primary); border-radius: 10px; flex-shrink: 0;">
              <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;"><path d="${officialLink.icon}"/></svg>
            </div>
            <div style="flex-grow: 1;">
              <div style="font-size: 0.85rem; font-weight: 700; color: rgb(var(--mdui-color-on-surface));">${localizedLabel}</div>
              <div style="font-size: 0.72rem; color: var(--on-surface-variant); opacity: 0.7; margin-top: 2px;">wmd.devianproject.tech</div>
            </div>
          </div>
        </mdui-card>
      `;
    }

    html += `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
    `;

    otherLinks.forEach((link) => {
      const transKey = linkTranslationMap[link.label];
      const localizedLabel = transKey ? (browser.i18n.getMessage(transKey) || link.label) : link.label;
      html += `
        <mdui-card href="${link.url}" target="_blank" clickable style="background: var(--surface-low); border: 1px solid rgb(var(--mdui-color-outline-variant)); border-radius: 12px; transition: var(--transition); height: 100%;">
          <div style="padding: 12px; display: flex; align-items: center; gap: 12px; height: 100%; box-sizing: border-box;">
            <div style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: rgba(var(--mdui-color-primary), 0.1); color: var(--primary); border-radius: 10px; flex-shrink: 0;">
              <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;"><path d="${link.icon}"/></svg>
            </div>
            <span style="font-size: 0.8rem; font-weight: 600; line-height: 1.2; color: rgb(var(--mdui-color-on-surface));">${localizedLabel}</span>
          </div>
        </mdui-card>
      `;
    });

    html += `
          </div>
        </div>

        <div style="text-align: center; margin-top: 12px; opacity: 0.5; font-size: 0.7rem;">
          ${browser.i18n.getMessage("releasedUnderLicense", [data.extension.license]) || `Released under ${data.extension.license} License`}
        </div>
      </div>
    `;

    container.innerHTML = html;

    const confirmReinstallBtn = document.getElementById('about-confirm-reinstalled');
    if (confirmReinstallBtn) {
      confirmReinstallBtn.addEventListener('click', async () => {
        try {
          await browser.storage.local.set({ 'wmd_reinstall_about_dismissed': '1' });
          loadAboutPage();
        } catch (e) {
          console.error("Failed to dismiss reinstall card:", e);
        }
      });
    }

    const checkBtn = document.getElementById('manual-check-update');
    const statusText = document.getElementById('update-status-text');
    let statusTimeout = null;

    if (checkBtn) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.loading = true;
        checkBtn.disabled = true;

        if (statusTimeout) clearTimeout(statusTimeout);
        if (statusText) {
          statusText.style.display = 'none';
          statusText.textContent = '';
        }

        let nativeUpdateFound = false;
        if (browser.runtime.requestUpdateCheck) {
          try {
            const result = await browser.runtime.requestUpdateCheck();
            if (result && result.status === 'update_available') {
              showUpdateDialog('https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader', result.version || 'new');
              nativeUpdateFound = true;
            }
          } catch (err) {
            console.warn('Native update check failed, trying GitHub fallback:', err);
          }
        }

        if (nativeUpdateFound) {
          checkBtn.loading = false;
          checkBtn.disabled = false;
          return;
        }

        try {
          const result = await performUpdateCheck();
          if (result.updateAvailable) {
            showUpdateDialog(result.updateUrl, result.latestVersion);
          } else {
            if (statusText) {
              statusText.textContent = browser.i18n.getMessage("alreadyLatestVersion") || "You are using the latest version.";
              statusText.style.display = 'block';
              statusText.style.color = 'var(--on-surface-variant)';
              statusTimeout = setTimeout(() => {
                statusText.style.display = 'none';
              }, 3000);
            }
          }
        } catch (error) {
          console.error('Manual check failed:', error);
          if (statusText) {
            statusText.textContent = browser.i18n.getMessage("updateCheckError") || "Failed to check for updates.";
            statusText.style.display = 'block';
            statusText.style.color = 'rgb(var(--mdui-color-error))';
            statusTimeout = setTimeout(() => {
              statusText.style.display = 'none';
            }, 3000);
          }
        } finally {
          checkBtn.loading = false;
          checkBtn.disabled = false;
        }
      });
    }
  } catch (error) {
    console.error("Failed to load about page:", error);
    container.innerHTML = `<div style="padding: 40px; text-align: center;">${browser.i18n.getMessage("failedToLoadAbout") || "Failed to load About page information."}</div>`;
  }
}

function isYoutubeVideoItem(item) {
  const request = item instanceof HTMLElement
    ? allFilteredRequests.find(entry => entry.bestRequest.originalUrl === item.dataset.url || entry.bestRequest.url === item.dataset.url)
    : item;
  const bestRequest = request?.bestRequest || {};
  const isVideo = request?.isVideo || request?.type === 'video';
  const source = `${bestRequest.originalUrl || bestRequest.url || ''} ${bestRequest.pageUrl || ''}`;

  return Boolean(isVideo && (
    request?.ytFormats?.length ||
    bestRequest.ytFormats?.length ||
    /(?:^|[./])(?:youtube\.com|youtu\.be|googlevideo\.com)(?:[/:]|$)/i.test(source)
  ));
}

async function downloadAllAsZip(items) {
  items = items.filter(item => !isYoutubeVideoItem(item));
  if (items.length === 0) return;

  const backgroundSetting = await browser.storage.local.get('background-download');
  const backgroundDownloadEnabled = backgroundSetting['background-download'] !== '0';

  const downloadItems = [];
  const progressContainer = document.getElementById('global-progress-container');
  const progressBar = document.getElementById('global-progress-bar');
  const progressText = document.getElementById('global-progress-text');

  try {
    await ensureScriptLoaded('libraries/client-zip.js', 'downloadZip');
    progressContainer.style.display = 'flex';
    progressBar.value = 0;
    progressText.textContent = browser.i18n.getMessage("zipPreparing", [items.length]);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let url, targetRequest;

      if (item instanceof HTMLElement) {
        url = item.dataset.url;
        const requestData = allFilteredRequests.find(r => r.bestRequest.originalUrl === url || r.bestRequest.url === url);
        targetRequest = requestData ? requestData.bestRequest : null;
      } else {

        url = item.bestRequest.originalUrl;
        targetRequest = item.bestRequest;
      }

      const originalFileName = getFileName(url, 100);
      let filename = originalFileName;
      let counter = 1;
      while (downloadItems.some(e => e.filename === filename)) {
        const parts = originalFileName.split('.');
        if (parts.length > 1) {
          const ext = parts.pop();
          filename = `${parts.join('.')}_${counter}.${ext}`;
        } else {
          filename = `${originalFileName}_${counter}`;
        }
        counter++;
      }

      downloadItems.push({ url, filename, request: targetRequest });
    }

    // With background downloads disabled, keep the work owned by this UI so
    // closing the extension view also stops the download.
    if (!backgroundDownloadEnabled || !browser.tabs?.create) {

      try {
        let skipAllErrors = false;
        progressBar.max = downloadItems.length;

        const zipEntriesGenerator = async function* () {
          for (let i = 0; i < downloadItems.length; i++) {
            const item = downloadItems[i];

            if (window.activeCancellations && window.activeCancellations.has('global_zip')) {
              throw new Error("Cancelled");
            }

            progressText.textContent = browser.i18n.getMessage("zipDownloading", [i + 1, downloadItems.length, item.filename]);
            progressBar.value = i;

            try {
              const response = await spoofedFetch(item.url, item.request);
              if (!response.ok) throw new Error(`Server returned ${response.status}`);

              const blob = await response.blob();
              yield { name: item.filename, input: blob };
            } catch (err) {
              console.warn(`Local ZIP fetch error for ${item.url}:`, err);
              if (skipAllErrors) continue;

              const result = await showConfirmDialog(
                browser.i18n.getMessage("zipDownloadError", [item.filename, err.message]),
                browser.i18n.getMessage("downloadErrorTitle") || "Download Error"
              );

              if (result === 'continue-all') {
                skipAllErrors = true;
                continue;
              }
              if (result !== 'continue') {
                throw new Error("Cancelled by user after error");
              }
            }
          }
        };

        progressText.textContent = browser.i18n.getMessage("zipGenerating") || "Generating ZIP archive...";
        progressBar.indeterminate = true;

        const zipBlob = await downloadZip(zipEntriesGenerator()).blob();
        const zipName = `downloads_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

        if (typeof finalizeDownload === 'function') {
            const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method'] || 'browser');
            await finalizeDownload(zipBlob, zipName, downloadMethod, progressBar, false, false);
            setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);
        } else {
            const blobUrl = URL.createObjectURL(zipBlob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = zipName;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
              progressContainer.style.display = 'none';
            }, 2000);
        }

        if (typeof mdui !== 'undefined' && mdui.snackbar) {
          mdui.snackbar({ message: browser.i18n.getMessage("zipComplete") || "ZIP download complete!", placement: "top" });
        }

      } catch (e) {
        if (e.message !== "Cancelled") {
          console.error("Local ZIP error:", e);
          showDialog(browser.i18n.getMessage("zipError", [e.message]));
        }
        progressContainer.style.display = 'none';
      }
    } else {

      browser.runtime.sendMessage({
        action: 'startPersistentZipJob',
        items: downloadItems
      });

      if (typeof mdui !== 'undefined' && mdui.snackbar) {
        mdui.snackbar({
          message: browser.i18n.getMessage("zipStartedInBackground") || "ZIP download started in background",
          placement: "top"
        });
      }
    }

  } catch (error) {
    console.error('ZIP background start error:', error);
    progressText.textContent = browser.i18n.getMessage("zipError", [error.message]);
    progressBar.value = 0;
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 5000);
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
  } catch (e) { return browser.i18n.getMessage("defaultMediaName") || "Media File"; }
}

function getHumanReadableSize(size) {
  const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
  let sizeInBytes = parseInt(size);
  if (isNaN(sizeInBytes)) return browser.i18n.getMessage("unknownSize") || "Unknown Size";
  let i = 0;
  while (sizeInBytes > 1024 && i < units.length - 1) { sizeInBytes /= 1024; i++; }
  return `${sizeInBytes.toFixed(2)} ${units[i]}`;
}

async function audioBufferToWav(buffer, onProgress, checkCancel = null) {
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
    if (checkCancel && checkCancel()) throw new Error("Cancelled");
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

async function extractAudioFromBlob(blob, filename, downloadMethod, loadingBar, checkCancel = null) {
  let extractionStage = 'initialization';
  let statusInfo = null;
  if (loadingBar) {
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
      if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("decodingAudio");
  }

  await new Promise(r => setTimeout(r, 200));

  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  try {
      extractionStage = 'audio decode';
      const audioBuffer = await new Promise((resolve, reject) => {
          let settled = false;
          const resolveOnce = (value) => {
              if (!settled) { settled = true; resolve(value); }
          };
          const rejectOnce = (error) => {
              if (!settled) { settled = true; reject(error); }
          };
          try {
              const result = audioCtx.decodeAudioData(arrayBuffer.slice(0), resolveOnce, rejectOnce);
              if (result && typeof result.then === 'function') result.then(resolveOnce, rejectOnce);
          } catch (error) {
              rejectOnce(error);
          }
      });
      if (loadingBar) {
          loadingBar.removeAttribute('indeterminate');
          loadingBar.max = 100;
      }

      extractionStage = 'WAV encoding';
      const wavBlob = await audioBufferToWav(audioBuffer, (progress) => {
          if (checkCancel && checkCancel()) throw new Error("Cancelled");
          if (loadingBar) {
              const percent = Math.round(progress * 100);
              loadingBar.value = percent;
              if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("encodingProgress", [percent.toString()]) || `Encoding: ${percent}%`;
          }
      }, checkCancel);

      let finalBlob = wavBlob;
      let finalFilename = filename;

      if (typeof convertAudioToMp3IfEnabled !== 'undefined') {
          extractionStage = 'MP3 encoding';
          const mp3Result = await convertAudioToMp3IfEnabled(wavBlob, filename, loadingBar, checkCancel);
          if (mp3Result) {
              finalBlob = mp3Result.blob;
              finalFilename = mp3Result.filename;
          }
      }

      if (typeof finalizeDownload !== 'undefined') {
          extractionStage = 'saving output';
          await finalizeDownload(finalBlob, finalFilename, downloadMethod, loadingBar, false, false);
      } else {
          const finalUrl = URL.createObjectURL(finalBlob);
          if (downloadMethod === "browser") {
            await browser.downloads.download({ url: finalUrl, filename: finalFilename });
          } else {
            const a = document.createElement("a");
            a.href = finalUrl;
            a.download = finalFilename;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
          setTimeout(() => URL.revokeObjectURL(finalUrl), 10000);
      }
  } catch (e) {
      const errorMessage = e?.message || e?.error?.message || e?.name ||
          (typeof e === 'string' ? e : '') || 'Unknown browser media error';
      if (errorMessage.toLowerCase().includes("unknown content type")) {
          throw new Error(browser.i18n.getMessage("audioExtractionFormatNotSupported") || "Your browser does not support audio extraction from this media format (typically .ts streams). Please download the full video and extract the audio manually.");
      }
      throw new Error(`Failed to extract audio during ${extractionStage}: ${errorMessage}`);
  } finally {
      try { audioCtx.close(); } catch(e) {}
  }
}

async function downloadAudioOnly(url, mediaDiv, specificSize) {
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}

  if (window.activeCancellations) {
      window.activeCancellations.delete(url);
  }

  try {
   const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url });
   let targetRequest = requests[url]?.find(r => r.size === specificSize) || requests[url]?.[0];

   if (!targetRequest && mediaDiv && mediaDiv.dataset.originalUrl) {
       const ogUrl = mediaDiv.dataset.originalUrl;
       const ogReqs = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: ogUrl });
       targetRequest = ogReqs[ogUrl]?.[0];
   }

   if (!targetRequest) {
       console.warn("Target request metadata not found, using generic fallback.");
       targetRequest = { responseHeaders: [] };
   }

   const settings = await browser.storage.local.get(['filename-template', 'disable-rename-dialog', 'audio-to-mp3']);
   const initialIsYouTube = /(?:googlevideo\.com|youtube\.com|youtu\.be)/i.test(url) ||
       !!(mediaDiv && mediaDiv.dataset.originalUrl && /(?:youtube\.com|googlevideo\.com|youtu\.be)/i.test(mediaDiv.dataset.originalUrl));
   if (initialIsYouTube) {
       const originalPageUrl = targetRequest.pageUrl || targetRequest.tabUrl || '';
       const originalTitle = targetRequest.pageTitle || '';
       const m4aCandidates = Object.entries(requests).filter(([candidateUrl, candidateRequests]) => {
           const decoded = decodeURIComponent(candidateUrl).toLowerCase();
           if (!(decoded.includes('#audio.m4a') || decoded.includes('mime=audio/mp4'))) return false;
           const candidate = candidateRequests?.[0] || {};
           if (originalPageUrl && (candidate.pageUrl || candidate.tabUrl)) {
               return (candidate.pageUrl || candidate.tabUrl) === originalPageUrl;
           }
           return !originalTitle || !candidate.pageTitle || candidate.pageTitle.startsWith(originalTitle);
       });
       const getAudioBitrate = ([candidateUrl, candidateRequests]) => {
           const candidate = candidateRequests?.[0] || {};
           const metadataBitrate = Number(candidate.audioBitrate || candidate.bitrate || 0);
           if (metadataBitrate > 0) return metadataBitrate;

           try {
               const parsed = new URL(candidateUrl.split('#')[0]);
               const urlBitrate = Number(parsed.searchParams.get('bitrate') || parsed.searchParams.get('abr') || 0);
               if (urlBitrate > 0) return urlBitrate;

               const itag = Number(parsed.searchParams.get('itag') || 0);
               const knownM4aBitrates = {
                   139: 48000,
                   140: 128000,
                   141: 256000,
                   256: 192000,
                   258: 384000,
                   325: 256000,
                   328: 256000
               };
               return knownM4aBitrates[itag] || 0;
           } catch (error) {
               return 0;
           }
       };
       m4aCandidates.sort((a, b) => {
           const bitrateDifference = getAudioBitrate(b) - getAudioBitrate(a);
           if (bitrateDifference !== 0) return bitrateDifference;
           const aReq = a[1]?.[0] || {};
           const bReq = b[1]?.[0] || {};
           return Number(bReq.size || bReq.contentLength || 0) - Number(aReq.size || aReq.contentLength || 0);
       });
       if (m4aCandidates.length > 0) {
           url = m4aCandidates[0][0];
           targetRequest = m4aCandidates[0][1]?.[0] || targetRequest;
           specificSize = targetRequest.size || specificSize;
       }
   }

   const defaultName = mediaFilename.resolve(url, targetRequest);
const template = (settings['filename-template'] && settings['filename-template'] !== '0') ? settings['filename-template'] : '';
   const disableRename = settings['disable-rename-dialog'] === '1';
   let finalName = defaultName;

   if (template) {
       finalName = await generateTemplateName(template, url, defaultName, targetRequest.pageTitle);
   }


   const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');
   let audioExt = settings['audio-to-mp3'] === '1' ? ".mp3" : (url.toLowerCase().includes('.mpd') ? ".m4a" : ".wav");

   finalName = mediaFilename.changeExtension(finalName, audioExt);

   let newName = finalName;
   if (!disableRename) {
       newName = await showRenameDialog(finalName);
       if (newName === null) return;
   }

   const isYouTubeSource = url.toLowerCase().includes('googlevideo.com') ||
       url.toLowerCase().includes('youtube.com') ||
       url.toLowerCase().includes('youtu.be') ||
       (mediaDiv && mediaDiv.dataset.originalUrl && /(?:youtube\.com|googlevideo\.com|youtu\.be)/i.test(mediaDiv.dataset.originalUrl));
   const isYouTubeAudioSource = isYouTubeSource && (
       (mediaDiv && mediaDiv.dataset.audioUrl === url) ||
       /(?:mime=audio|#audio)/i.test(decodeURIComponent(url))
   );
   const shouldEncodeMp3 = isYouTubeAudioSource && settings['audio-to-mp3'] === '1';
   const shouldEncodeDirectMp3 = settings['audio-to-mp3'] === '1' && !isStream;
   const directAudioSource = isYouTubeAudioSource && !shouldEncodeMp3;

   if (directAudioSource) {
       newName = newName.replace(/\.wav$/i, '.mov');
   }

    

    if (mediaDiv) {
      const audioBtn = mediaDiv.querySelector('#audio-only-button');
      const dlBtn = mediaDiv.querySelector('#download-button');
      const cancelBtn = mediaDiv.querySelector('#cancel-button');
      if (audioBtn) audioBtn.style.display = 'none';
      if (dlBtn) {
        dlBtn.disabled = true;
        dlBtn.style.borderRadius = '';
      }
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    }

    updateDownloadingCount(1);
    const progressContainer = document.createElement('div');
    progressContainer.className = 'download-progress-container';

    const loadingBar = document.createElement('mdui-linear-progress');
    const statusInfo = document.createElement('div');
    statusInfo.className = 'download-status-info';

    progressContainer.appendChild(loadingBar);
    progressContainer.appendChild(statusInfo);
    mediaDiv.appendChild(progressContainer);

    loadingBar.style.width = '100%';
    loadingBar.setAttribute('indeterminate', 'true');

    uiCache.set(url, { element: mediaDiv, loadingBar, statusInfo, progressContainer });

    const dlSettings = await browser.storage.local.get(['download-method', 'stream-download', 'background-download']);
    let downloadMethod = dlSettings['download-method'] || 'browser';
    let streamPref = dlSettings['stream-download'] || 'offline';
    const bgDownloadEnabled = dlSettings['background-download'] !== '0';

try {
        if (!bgDownloadEnabled) throw new Error('Background download disabled');
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
            const response = await browser.tabs.sendMessage(activeTab.id, { action: 'ping' }).catch(() => null);
            if (response && response.pong && !isStream) {
                const backgroundJob = await browser.runtime.sendMessage({
                    action: 'startPersistentAudioJob',
                    url: url,
                    filename: newName,
                    isYouTube: isYouTubeSource,
                    audioOnly: true,
                    directAudioSource,
                    encodeM4aToMp3: shouldEncodeDirectMp3,
                    request: targetRequest
                });
                if (!backgroundJob?.success) throw new Error(backgroundJob?.error || 'Unable to start background audio job');
                if (backgroundJob.jobId && mediaDiv) {
                    mediaDiv.dataset.downloadId = backgroundJob.jobId;
                    const cachedItem = uiCache.get(url);
                    if (cachedItem) uiCache.set(backgroundJob.jobId, cachedItem);
                }
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    mdui.snackbar({
                        message: browser.i18n.getMessage("downloadStarted") || "Download started in background tab",
                        placement: "top"
                    });
                }
                return;
            }
        }
    } catch (err) {
        if (bgDownloadEnabled) console.warn("Failed to delegate to tab content script, running in popup fallback:", err);
    }

    if (!bgDownloadEnabled) {
        if (streamPref === 'offline') streamPref = 'stream';
    }

   const selectedRes = mediaDiv ? mediaDiv.dataset.selectedResolution : '';
   if (isStream) {
      if (url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd')) {
          if (streamPref === 'offline') {
              loadingBar.max = 100;
              loadingBar.setAttribute('indeterminate', 'true');
              statusInfo.textContent = browser.i18n.getMessage('preparingManifest') || 'Preparing stream...';
              const streamJob = await browser.runtime.sendMessage({
                  action: 'startPersistentStreamJob', url, filename: newName,
                  quality: selectedRes || 'highest', audioOnly: true,
                  request: targetRequest, downloadMethod
              });
              if (!streamJob?.success) throw new Error(streamJob?.error || 'Unable to start stream download');
              return;
          }
          const result = url.toLowerCase().includes('.mpd')
            ? await downloadMPDOffline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, true, selectedRes)
            : await downloadM3U8Offline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, true, selectedRes);
          if (window.activeCancellations.has(url)) throw new Error("Cancelled");

          finishDownloadUI(url, true);
          return;
      } else {
          showDialog(browser.i18n.getMessage("audioExtractionNotSupported"), browser.i18n.getMessage("notSupportedTitle"));
          finishDownloadUI(url);
          return;
      }
   } else {
      try {
          const checkCancel = () => window.activeCancellations && window.activeCancellations.has(url);
          const isYouTube = url.toLowerCase().includes('googlevideo.com') || url.toLowerCase().includes('youtube.com') || url.toLowerCase().includes('youtu.be') || (mediaDiv && mediaDiv.dataset.originalUrl && (mediaDiv.dataset.originalUrl.toLowerCase().includes('youtube.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('googlevideo.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('youtu.be')));

          let blob;
          if (isYouTube) {
              const uint8Array = await window.fetchAsUint8ArrayChunked(url, loadingBar, statusInfo, checkCancel);
              blob = new Blob([uint8Array.buffer]);
          } else {
              const response = await spoofedFetch(url);
              if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

              const contentLength = +(response.headers.get('Content-Length') || 0);
              const reader = response.body.getReader();
              let receivedLength = 0;
              let chunks = [];

              loadingBar.removeAttribute('indeterminate');
              if (contentLength > 0) loadingBar.max = contentLength;

              while(true) {
                if (window.activeCancellations.has(url)) {
                  reader.cancel();
                  throw new Error("Cancelled");
                }
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedLength += value.length;

                if (contentLength > 0) {
                    loadingBar.value = receivedLength;
                    const percent = Math.round((receivedLength / contentLength) * 100);
                    const loadedMB = (receivedLength / 1048576).toFixed(1);
                    const totalMB = (contentLength / 1048576).toFixed(1);
                    statusInfo.textContent = browser.i18n.getMessage("downloadProgressWithSize", [percent.toString(), loadedMB, totalMB]) || `Downloading: ${percent}% (${loadedMB}MB / ${totalMB}MB)`;
                } else {
                    const loadedMB = (receivedLength / 1048576).toFixed(1);
                    statusInfo.textContent = browser.i18n.getMessage("downloadProgressNoSize", [loadedMB]) || `Downloading: ${loadedMB}MB`;
                }
              }
              blob = new Blob(chunks);
          }
          statusInfo.textContent = browser.i18n.getMessage("downloadCompletePreparingExtraction");
          await new Promise(r => setTimeout(r, 500));
          if (window.activeCancellations.has(url)) throw new Error("Cancelled");
          if (directAudioSource) {
              const movBlob = new Blob([blob], { type: 'video/quicktime' });
              await finalizeDownload(movBlob, newName, downloadMethod, loadingBar, false, false);
          } else if (shouldEncodeDirectMp3) {
              const result = await convertM4aToMp3Direct(blob, newName, loadingBar, checkCancel);
              await finalizeDownload(result.blob, result.filename, downloadMethod, loadingBar, false, false);
          } else {
              await extractAudioFromBlob(blob, newName, downloadMethod, loadingBar, checkCancel);
          }
      } catch (e) {
          throw new Error(e.message === "Cancelled" ? "Cancelled" : browser.i18n.getMessage("downloadError", [e.message]));
      }
   }
   finishDownloadUI(url, true);
  } catch (error) {
    if (error.message !== "Cancelled") {
      showDialog(browser.i18n.getMessage("audioExtractionError", [error.message]));
    }
    finishDownloadUI(url);
  } finally {
    const restoreCb = window.activeCancellations.restoreCallbacks.get(url);
    if (restoreCb) restoreCb();
    window.activeCancellations.restoreCallbacks.delete(url);
    window.activeCancellations.delete(url);
    if (wakeLock) wakeLock.release();
  }
}
async function downloadFile(url, mediaDiv, specificSize, silent = false, audioUrl = null, subtitleUrl = null, customFilename = null) {
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}

  let selectedSubUrls = [];
  if (mediaDiv && mediaDiv.dataset.selectedSubtitles) {
      try {
          selectedSubUrls = JSON.parse(mediaDiv.dataset.selectedSubtitles);
      } catch (err) {
          console.error(err);
      }
  }

  const toIso3 = (lang) => {
      const map = { en:'eng', id:'ind', ja:'jpn', ko:'kor', zh:'zho', fr:'fra', de:'deu',
                    es:'spa', pt:'por', ru:'rus', ar:'ara', hi:'hin', tr:'tur', it:'ita',
                    nl:'nld', pl:'pol', th:'tha', vi:'vie', sv:'swe', fi:'fin', da:'dan',
                    no:'nor', cs:'ces', sk:'slk', ro:'ron', hu:'hun', el:'ell', uk:'ukr' };
      if (!lang) return 'und';
      const base = lang.split('-')[0].toLowerCase();
      if (base.length === 3) return base;
      return map[base] || 'und';
  };

  const cleanVtt = (raw) => {
      let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (!text.startsWith('WEBVTT')) text = 'WEBVTT\n\n' + text;
      text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      const tsToSec = (ts) => {
          const p = ts.trim().split(':');
          if (p.length === 3) return +p[0]*3600 + +p[1]*60 + parseFloat(p[2]);
          return +p[0]*60 + parseFloat(p[1]);
      };
      const blocks = text.split(/\n\n+/);
      const header = blocks[0];
      const cueRe = /^([\d:.]+)\s+-->\s+([\d:.]+)/;
      const cues = [];
      for (let b = 1; b < blocks.length; b++) {
          const block = blocks[b].trim();
          if (!block) continue;
          const lines = block.split('\n');
          let ti = cueRe.test(lines[0]) ? 0 : 1;
          if (ti >= lines.length) continue;
          const m = lines[ti].match(/^([\d:.]+)\s+-->\s+([\d:.]+)/);
          if (!m) continue;
          const payload = lines.slice(ti+1).join('\n')
              .replace(/<\d{2}:\d{2}:\d{2}\.\d.3}>/g, '').replace(/<\/?c>/g, '')
              .replace(/<[^>]+>/g, '').trim();
          if (!payload) continue;
          cues.push({ s: tsToSec(m[1]), e: tsToSec(m[2]), t1: m[1], t2: m[2], p: payload });
      }
      const seen = new Map();
      for (const c of cues) seen.set(c.s, c);
      const sorted = Array.from(seen.values()).sort((a, b) => a.s - b.s);
      let maxE = 0;
      for (const c of sorted) {
          if (c.s < maxE) c.s = maxE;
          if (c.s >= c.e) c.e = c.s + 0.001;
          maxE = c.e;
      }
      if (!sorted.length) return null;
      const f2 = (n) => String(Math.floor(n)).padStart(2,'0');
      const toTs = (s) => `${f2(s/3600)}:${f2((s%3600)/60)}:${(s%60).toFixed(3).padStart(6,'0')}`;
      return header + '\n\n' + sorted.map((c,i) => `${i+1}\n${toTs(c.s)} --> ${toTs(c.e)}\n${c.p}`).join('\n\n');
  };

  const fetchUrlAsBlob = async (fetchUrl, statusEl, statusPrefix) => {
      const controller = new AbortController();
      try {
          let probeResp = await spoofedFetch(fetchUrl, { headers: { "Range": "bytes=0-0" }, signal: controller.signal });
          let isChunked = probeResp.status === 206;
          let size = 0;
          if (isChunked) {
              const cr = probeResp.headers.get('Content-Range');
              if (cr) {
                  const match = cr.match(/\/(\d+)$/);
                  if (match) size = parseInt(match[1], 10);
              }
          }
          if (!isChunked || !size) {
              const resp = await spoofedFetch(fetchUrl);
              if (!resp.ok) throw new Error("HTTP " + resp.status);
              return await resp.blob();
          }
          const CHUNK_SIZE = 1024 * 1024;
          let chunks = [];
          let downloaded = 0;
          for (let start = 0; start < size; start += CHUNK_SIZE) {
              let end = Math.min(start + CHUNK_SIZE - 1, size - 1);
              let retries = 3;
              let chunkResp;
              while (retries > 0) {
                  try {
                      chunkResp = await spoofedFetch(fetchUrl, { headers: { "Range": `bytes=${start}-${end}` } });
                      if (chunkResp.ok || chunkResp.status === 206) break;
                  } catch (e) {
                      console.warn("Chunk fetch failed, retrying...", e);
                  }
                  retries--;
                  if (retries === 0) throw new Error("Failed to fetch chunk " + start);
                  await new Promise(r => setTimeout(r, 1000));
              }
              const arrayBuf = await chunkResp.arrayBuffer();
              chunks.push(new Uint8Array(arrayBuf));
              downloaded += arrayBuf.byteLength;
              if (statusEl) {
                  const pct = Math.round((downloaded / size) * 100);
                  statusEl.textContent = `${statusPrefix} (${pct}%)`;
              }
          }
          return new Blob(chunks);
      } catch (e) {
          console.error("fetchUrlAsBlob failed, trying fallback:", e);
          const resp = await spoofedFetch(fetchUrl);
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          return await resp.blob();
      }
  };

  try {
   const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url });
   let targetRequest = requests[url]?.find(r => r.size === specificSize) || requests[url]?.[0];

   if (!targetRequest && mediaDiv && mediaDiv.dataset.originalUrl) {
       const ogUrl = mediaDiv.dataset.originalUrl;
       const ogReqs = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: ogUrl });
       targetRequest = ogReqs[ogUrl]?.[0];
   }

   if (!targetRequest) {
       console.warn("Target request metadata not found, using generic fallback.");
       targetRequest = { responseHeaders: [] };
   }

   let downloadId = 'dl_' + Date.now();
   if (mediaDiv) {
     const dlBtn = mediaDiv.querySelector('#download-button');
     if (dlBtn) {
       updatePausePlayUI(dlBtn, false);
       dlBtn.style.borderRadius = '';
     }
     const cancelBtn = mediaDiv.querySelector('#cancel-button');
     if (cancelBtn) cancelBtn.style.display = 'inline-flex';
     const audioBtn = mediaDiv.querySelector('#audio-only-button');
     if (audioBtn) audioBtn.style.display = 'none';
     mediaDiv.dataset.downloadId = downloadId;
   }

   const defaultName = mediaFilename.resolve(url, targetRequest);
    const settings = await browser.storage.local.get(['filename-template', 'disable-rename-dialog']);
    const template = (settings['filename-template'] && settings['filename-template'] !== '0') ? settings['filename-template'] : '';
    const disableRename = settings['disable-rename-dialog'] === '1';
    let finalName = customFilename || defaultName;

    if (template && !customFilename) {
        finalName = await generateTemplateName(template, url, defaultName, targetRequest.pageTitle);
    }

    if (audioUrl) {
        let extMatch = url.match(/#(?:video|audio)\.([a-zA-Z0-9]+)$/);
        let ext = extMatch ? '.' + extMatch[1] : '.mp4';
        if (!finalName.toLowerCase().endsWith(ext)) finalName += ext;
    } else {
        let extMatch = url.match(/#[a-zA-Z0-9_]+\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
            let ext = '.' + extMatch[1];
            if (!finalName.toLowerCase().endsWith(ext)) {
                finalName += ext;
            }
        }
    }

    let newName = finalName;
    if (!silent) {
      if (!disableRename) {
        newName = await showRenameDialog(finalName);
        if (newName === null) {
            finishDownloadUI(downloadId);
            return;
        }
      }
    }

    

    updateDownloadingCount(1);
    let loadingBar = null;
    let statusInfo = null;
    let progressContainer = null;

    if (mediaDiv) {
      progressContainer = document.createElement('div');
      progressContainer.className = 'download-progress-container';

      loadingBar = document.createElement('mdui-linear-progress');
      statusInfo = document.createElement('div');
      statusInfo.className = 'download-status-info';

      progressContainer.appendChild(loadingBar);
      progressContainer.appendChild(statusInfo);
      mediaDiv.appendChild(progressContainer);

      loadingBar.style.width = '100%';
      loadingBar.setAttribute('indeterminate', 'true');

      uiCache.set(downloadId, { element: mediaDiv, loadingBar, statusInfo, progressContainer });
    }

    const dlSettings = await browser.storage.local.get(['download-method', 'stream-download', 'background-download', 'mux-all-audios', 'embed-subtitles-mkv', 'embed-subtitles-container']);
    let downloadMethod = dlSettings['download-method'] || 'browser';
    if (url.includes('#audio.m4a') || url.includes('#audio.webm')) {
        downloadMethod = 'fetch';
    }
    let streamPref = dlSettings['stream-download'] || 'offline';
    const bgDownloadEnabled = dlSettings['background-download'] !== '0';
    const muxAllAudios = dlSettings['mux-all-audios'] === '1';
    const embedSubtitlesMkv = dlSettings['embed-subtitles-mkv'] === '1';
    const embedSubtitlesContainer = dlSettings['embed-subtitles-container'] || 'mp4';

    try {
        if (!bgDownloadEnabled) throw new Error('Background download disabled');
        const isYouTube = url.toLowerCase().includes('googlevideo.com') || url.toLowerCase().includes('youtube.com') || url.toLowerCase().includes('youtu.be') || (mediaDiv && mediaDiv.dataset.originalUrl && (mediaDiv.dataset.originalUrl.toLowerCase().includes('youtube.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('googlevideo.com') || mediaDiv.dataset.originalUrl.toLowerCase().includes('youtu.be')));
        if (isYouTube && (!subtitleUrl || subtitleUrl === 'none') && (audioUrl !== 'all' || muxAllAudios)) {
            let delegatedAudioUrl = audioUrl;
            if (audioUrl === 'all' && muxAllAudios) {
                const ytFormats = (mediaDiv && mediaDiv.ytFormats) || [];
                const seenAudioUrls = new Set();
                delegatedAudioUrl = ytFormats
                    .filter(fmt => fmt.audioUrl && !seenAudioUrls.has(fmt.audioUrl) && seenAudioUrls.add(fmt.audioUrl))
                    .map(fmt => ({
                        url: fmt.audioUrl,
                        name: fmt.audioTrack?.displayName || 'Default Audio'
                    }));
            }
            const backgroundJob = await browser.runtime.sendMessage({
                action: 'startPersistentAudioJob',
                url,
                audioUrl: delegatedAudioUrl || null,
                filename: newName,
                isYouTube: true,
                audioOnly: false,
                request: targetRequest,
                downloadMethod
            });
            if (!backgroundJob?.success) throw new Error(backgroundJob?.error || 'Unable to start background video job');
            if (backgroundJob.jobId && mediaDiv) {
                mediaDiv.dataset.downloadId = backgroundJob.jobId;
                const cachedItem = uiCache.get(downloadId) || uiCache.get(url);
                if (cachedItem) uiCache.set(backgroundJob.jobId, cachedItem);
            }
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({ message: browser.i18n.getMessage('downloadStarted') || 'Download started in background', placement: 'top' });
            }
            return;
        }
    } catch (err) {
        if (bgDownloadEnabled) console.warn("Failed to start persistent YouTube download, running in popup fallback:", err);
    }

    const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs[0];
    const pageUrl = activeTab ? activeTab.url : "";
    const pageTitle = activeTab ? activeTab.title : "";

    browser.runtime.sendMessage({
        action: 'addToHistory',
        item: { url, filename: newName, timestamp: Date.now(), pageUrl, pageTitle }
    });

    // Determine if subtitles should be embedded (Mediabunny) vs zipped
    const isSubtitleEmbed = embedSubtitlesMkv && subtitleUrl && subtitleUrl !== 'none';

    const isYtZipNeeded = (!isSubtitleEmbed && subtitleUrl && subtitleUrl !== 'none') || (audioUrl === 'all' && !muxAllAudios);

    if (isYtZipNeeded) {
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("zipPreparing") || "Preparing ZIP archive...";
        try {
            await ensureScriptLoaded('libraries/client-zip.js', 'downloadZip');
            await ensureScriptLoaded('libraries/subsrt.bundle.js', 'subsrt');
            const zipEntries = [];
            let videoBlob = null;
            let videoName = newName;
            const shouldDownloadVideo = true;

            if (shouldDownloadVideo) {
                if (statusInfo) statusInfo.textContent = "Downloading video stream...";
                if (audioUrl && audioUrl !== 'all') {
                    videoBlob = await downloadAndMuxYoutube(url, audioUrl, newName, downloadMethod, loadingBar, true);
                } else if (audioUrl === 'all') {
                    const ytFormats = (mediaDiv && mediaDiv.ytFormats) || [];
                    if (muxAllAudios) {
                        const uniqueAudios = [];
                        const seenAudioUrls = new Set();
                        ytFormats.forEach(fmt => {
                            if (fmt.audioUrl && !seenAudioUrls.has(fmt.audioUrl)) {
                                seenAudioUrls.add(fmt.audioUrl);
                                uniqueAudios.push({
                                    url: fmt.audioUrl,
                                    name: (fmt.audioTrack && fmt.audioTrack.displayName) ? fmt.audioTrack.displayName : "Default Audio"
                                });
                            }
                        });
                        videoBlob = await downloadAndMuxYoutube(url, uniqueAudios, newName, downloadMethod, loadingBar, true);
                    } else {
                        const formatSelect = mediaDiv ? mediaDiv.querySelector('.yt-format-select') : null;
                        const codecSelect = mediaDiv ? mediaDiv.querySelector('.yt-codec-select') : null;
                        const resSelect = mediaDiv ? mediaDiv.querySelector('.yt-resolution-select') : null;

                        const selectedDemuxer = formatSelect ? formatSelect.value : (ytFormats[0]?.demuxer || '');
                        const selectedCodec = codecSelect ? codecSelect.value : (ytFormats[0]?.codec || 'UNKNOWN');
                        const selectedRes = resSelect ? resSelect.value : (ytFormats[0]?.label || (ytFormats[0] ? `${ytFormats[0].width}x${ytFormats[0].height}` : ''));
                        const matchingFormats = ytFormats.filter(f =>
                            f.demuxer === selectedDemuxer &&
                            (f.codec === selectedCodec || (!f.codec && selectedCodec === 'UNKNOWN')) &&
                            ((f.label || `${f.width}x${f.height}`) === selectedRes)
                        );
                        const defaultFmt = matchingFormats.find(f => f.audioTrack && (f.audioTrack.audioIsDefault || f.audioTrack.audio_is_default)) || matchingFormats[0];
                        if (defaultFmt && defaultFmt.audioUrl) {
                            videoBlob = await downloadAndMuxYoutube(url, defaultFmt.audioUrl, newName, downloadMethod, loadingBar, true);
                        } else {
                            videoBlob = await fetchUrlAsBlob(url, statusInfo, "Downloading video stream");
                        }
                    }
                } else {
                    videoBlob = await fetchUrlAsBlob(url, statusInfo, "Downloading video stream");
                }
                if (videoBlob) {
                    zipEntries.push({ name: videoName, input: videoBlob });
                }
            }

            if (audioUrl === 'all' && !muxAllAudios) {
                const ytFormats = (mediaDiv && mediaDiv.ytFormats) || [];
                const uniqueAudios = [];
                const seenAudioUrls = new Set();
                ytFormats.forEach(fmt => {
                    if (fmt.audioUrl && !seenAudioUrls.has(fmt.audioUrl)) {
                        seenAudioUrls.add(fmt.audioUrl);
                        uniqueAudios.push({
                            url: fmt.audioUrl,
                            name: (fmt.audioTrack && fmt.audioTrack.displayName) ? fmt.audioTrack.displayName : "Default Audio"
                        });
                    }
                });

                for (let i = 0; i < uniqueAudios.length; i++) {
                    const item = uniqueAudios[i];
                    if (statusInfo) statusInfo.textContent = `Downloading audio ${i+1}/${uniqueAudios.length}: ${item.name}...`;
                    try {
                        const blob = await fetchUrlAsBlob(item.url, statusInfo, `Downloading audio ${i+1}/${uniqueAudios.length}: ${item.name}`);
                        let ext = '.m4a';
                        if (item.url.includes('.webm') || item.url.includes('mime=audio%2Fwebm') || item.url.includes('mime=audio/webm')) {
                            ext = '.webm';
                        }
                        const entryName = `${newName.replace(/\.[a-zA-Z0-9]+$/, '')} - ${item.name}${ext}`;
                        zipEntries.push({ name: entryName, input: blob });
                    } catch (err) {
                        console.error("Failed to download audio track:", item.name, err);
                    }
                }
            }

            if (subtitleUrl && subtitleUrl !== 'none') {
                const ytSubtitles = (mediaDiv && mediaDiv.ytSubtitles) || [];
                const subsToDownload = [];

                if (subtitleUrl === 'all') {
                    subsToDownload.push(...ytSubtitles);
                } else {
                    const selectedSub = ytSubtitles.find(s => s.vttUrl === subtitleUrl);
                    if (selectedSub) {
                        subsToDownload.push(selectedSub);
                    } else {
                        subsToDownload.push({ vttUrl: subtitleUrl, displayName: "Subtitle", language: "und" });
                    }
                }

                const subSettings = await browser.storage.local.get(['subtitle-conversion']);
                const subFormat = subSettings['subtitle-conversion'] || 'none';
                const targetFormat = subFormat !== 'none' ? subFormat : 'vtt';

                for (let i = 0; i < subsToDownload.length; i++) {
                    const sub = subsToDownload[i];
                    if (statusInfo) statusInfo.textContent = `Downloading subtitle ${i+1}/${subsToDownload.length}: ${sub.displayName || sub.language}...`;
                    try {
                        const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: sub.vttUrl });
                        let text = bgFetch && bgFetch.text ? bgFetch.text : null;
                        if (!text) {
                            const response = await spoofedFetch(sub.vttUrl);
                            if (response.ok) text = await response.text();
                        }
                        if (text) {
                            if (targetFormat === 'srt') {
                                if (typeof window.subsrt !== 'undefined') {
                                    text = window.subsrt.convert(text, { format: 'srt' });
                                } else if (text.trim().startsWith('WEBVTT')) {
                                    text = text.replace(/^WEBVTT[^\n]*\n+/i, '');
                                    text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{3})/g, '$1,$2');
                                }
                            } else if (targetFormat === 'vtt') {
                                if (!text.trim().startsWith('WEBVTT')) {
                                    text = "WEBVTT\n\n" + text.trim();
                                    text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/g, '$1.$2');
                                }
                            }
                            const subName = `${newName.replace(/\.[a-zA-Z0-9]+$/, '')} - ${sub.displayName || sub.language}.${targetFormat}`;
                            zipEntries.push({ name: subName, input: text });
                        }
                    } catch (err) {
                        console.error("Failed to fetch subtitle:", sub.displayName, err);
                    }
                }
            }

            if (zipEntries.length === 0) throw new Error("No files downloaded.");

            if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("zipGenerating") || "Generating ZIP archive...";
            const zipBlob = await downloadZip(zipEntries).blob();
            const zipName = `${newName.replace(/\.[a-zA-Z0-9]+$/, '')}.zip`;

            if (typeof finalizeDownload === 'function') {
                await finalizeDownload(zipBlob, zipName, downloadMethod, loadingBar, false, false);
            } else {
                const blobUrl = URL.createObjectURL(zipBlob);
                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = zipName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                }, 2000);
            }

            finishDownloadUI(downloadId, true);
        } catch (e) {
            console.error("ZIP creation failed:", e);
            if (typeof showDialog === 'function') showDialog("Failed to create ZIP: " + e.message);
            finishDownloadUI(downloadId, false);
        }
        return;
    }

    const nonYtSettings = await browser.storage.local.get(['embed-subtitles-nonyt']);
    const embedSubtitlesNonYt = nonYtSettings['embed-subtitles-nonyt'] === '1';
    const isNonYtSubtitleEmbed = embedSubtitlesNonYt && selectedSubUrls.length > 0;

    if (isNonYtSubtitleEmbed) {
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("startingDownload") || "Starting download...";
        try {
            if (statusInfo) statusInfo.textContent = "Downloading video...";
            const videoBlob = await fetchUrlAsBlob(url, statusInfo, "Downloading video");
            if (!videoBlob) throw new Error("Failed to download video file.");

            if (statusInfo) statusInfo.textContent = "Fetching subtitles...";
            const subData = [];
            for (let i = 0; i < selectedSubUrls.length; i++) {
                const subUrl = selectedSubUrls[i];
                if (statusInfo) statusInfo.textContent = `Fetching subtitle ${i+1}/${selectedSubUrls.length}...`;
                try {
                    const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: subUrl });
                    let text = bgFetch && bgFetch.text ? bgFetch.text : null;
                    if (!text) {
                        const resp = await spoofedFetch(subUrl);
                        if (resp.ok) text = await resp.text();
                    }
                    if (text) {
                        const cleaned = cleanVtt(text);
                        const matchedReq = allMediaRequests.find(r => (r.bestRequest.originalUrl === subUrl || r.bestRequest.url === subUrl));
                        const name = matchedReq ? (matchedReq.resolvedFilename || getFileName(subUrl)) : getFileName(subUrl);
                        let lang = 'und';
                        const langMatch = name.match(/[\s._-]([a-z]{2})[\s._-]/i) || name.match(/^([a-z]{2})[\s._-]/i);
                        if (langMatch) lang = langMatch[1].toLowerCase();
                        
                        if (cleaned) subData.push({ text: cleaned, language: lang, displayName: name.replace(/\.[a-zA-Z0-9]+$/, '') });
                    }
                } catch (err) {
                    console.error('Failed to fetch subtitle:', subUrl, err);
                }
            }

            if (statusInfo) statusInfo.textContent = 'Embedding subtitles with LibAV...';
            await embedSubtitlesWithLibAV(videoBlob, subData, embedSubtitlesContainer, newName, downloadMethod, loadingBar);
            finishDownloadUI(downloadId, true);
        } catch (e) {
            console.error("Non-YT subtitle embedding failed:", e);
            if (e.message !== "Cancelled") showDialog(browser.i18n.getMessage("downloadError", [e.message]));
            finishDownloadUI(downloadId, false);
        }
        return;
    }

    const subSettings = await browser.storage.local.get(['subtitle-conversion']);
    const subFormat = subSettings['subtitle-conversion'] || 'none';
    const mediaType = getMediaType(url, targetRequest.responseHeaders);
    if (mediaType === 'subtitle' && subFormat !== 'none') {
        try {
            let text;
            const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: url });
            if (bgFetch && bgFetch.text) {
                text = bgFetch.text;
            } else {
                const response = await spoofedFetch(url);
                if (!response.ok) throw new Error("Fetch failed");
                text = await response.text();
            }

            try {
                if (typeof window.subsrt !== 'undefined') {
                    text = window.subsrt.convert(text, { format: subFormat });
                } else {
                    throw new Error("subsrt not loaded");
                }
            } catch (convErr) {
                console.warn("subsrt conversion failed, using fallback:", convErr);
                if (subFormat === 'srt') {
                    if (text.trim().startsWith('WEBVTT')) {
                        text = text.replace(/^WEBVTT[^\n]*\n+/i, '');
                        text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{3})/g, '$1,$2');
                    }
                } else if (subFormat === 'vtt') {
                    if (!text.trim().startsWith('WEBVTT')) {
                        text = "WEBVTT\n\n" + text.trim();
                        text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/g, '$1.$2');
                    }
                }
            }

            newName = newName.replace(/\.[a-z0-9]+$/i, '.' + subFormat);
            if (!newName.toLowerCase().endsWith('.' + subFormat)) newName += '.' + subFormat;

            let mimeType = 'application/octet-stream';
            if (subFormat === 'srt') mimeType = 'application/x-subrip';
            if (subFormat === 'vtt') mimeType = 'text/vtt';
            const blobUrl = URL.createObjectURL(new Blob([text], {type: mimeType}));
            if (typeof finalizeDownload === 'function') {
                const blob = new Blob([text], {type: mimeType});
                await finalizeDownload(blob, newName, downloadMethod, loadingBar, false, false);
            } else {
                if (downloadMethod === 'browser') {
                    const id = await browser.downloads.download({ url: blobUrl, filename: newName, saveAs: false });
                    if (mediaDiv) mediaDiv.dataset.downloadId = id;
                } else {
                    const a = document.createElement("a");
                    a.href = blobUrl;
                    a.download = newName;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => document.body.removeChild(a), 1000);
                }
                setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            }
            finishDownloadUI(downloadId, true);
            return;
        } catch (e) {
            console.error("Subtitle conversion failed", e);
        }
    }

    if (!bgDownloadEnabled) {
        if (streamPref === 'offline') streamPref = 'stream';
    }

    const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');
    const cloudSettings = await browser.storage.local.get(['save-to-gdrive', 'save-to-dropbox']);
    const cloudEnabled = cloudSettings['save-to-gdrive'] === '1' || cloudSettings['save-to-dropbox'] === '1';

    if (audioUrl) {
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("startingDownload") || "Starting download...";
        try {
            console.log("downloadFile: Calling downloadAndMuxYoutube...");

            let targetAudio = audioUrl;
            if (audioUrl === 'all' && muxAllAudios) {
                const ytFormats = (mediaDiv && mediaDiv.ytFormats) || [];
                const uniqueAudios = [];
                const seenAudioUrls = new Set();
                ytFormats.forEach(fmt => {
                    if (fmt.audioUrl && !seenAudioUrls.has(fmt.audioUrl)) {
                        seenAudioUrls.add(fmt.audioUrl);
                        uniqueAudios.push({
                            url: fmt.audioUrl,
                            name: (fmt.audioTrack && fmt.audioTrack.displayName) ? fmt.audioTrack.displayName : "Default Audio"
                        });
                    }
                });
                targetAudio = uniqueAudios;
            }

            if (window.activeCancellations) {
                window.activeCancellations.delete(url);
                if (Array.isArray(targetAudio)) {
                    targetAudio.forEach(item => window.activeCancellations.delete(item.url));
                } else {
                    window.activeCancellations.delete(targetAudio);
                }
            }

            if (isSubtitleEmbed) {
                // If subtitle embedding is enabled, we first download and mux the video + audio(s) into a temporary blob
                console.log("downloadFile: isSubtitleEmbed is active. Muxing to temp blob...");
                if (statusInfo) statusInfo.textContent = "Downloading and muxing video+audio...";
                const muxedBlob = await downloadAndMuxYoutube(url, targetAudio, newName, downloadMethod, loadingBar, true);

                if (statusInfo) statusInfo.textContent = "Fetching subtitles...";

                // Get all subtitles to embed
                const ytSubtitles = (mediaDiv && mediaDiv.ytSubtitles) || [];
                const subsToEmbed = [];
                if (subtitleUrl === 'all') {
                    subsToEmbed.push(...ytSubtitles);
                } else {
                    const selectedSub = ytSubtitles.find(s => s.vttUrl === subtitleUrl);
                    subsToEmbed.push(selectedSub || { vttUrl: subtitleUrl, displayName: 'Subtitle', language: 'und' });
                }

                // Helper: convert 2-letter lang code to 3-letter ISO 639-2/T
                const toIso3 = (lang) => {
                    const map = { en:'eng', id:'ind', ja:'jpn', ko:'kor', zh:'zho', fr:'fra', de:'deu',
                                  es:'spa', pt:'por', ru:'rus', ar:'ara', hi:'hin', tr:'tur', it:'ita',
                                  nl:'nld', pl:'pol', th:'tha', vi:'vie', sv:'swe', fi:'fin', da:'dan',
                                  no:'nor', cs:'ces', sk:'slk', ro:'ron', hu:'hun', el:'ell', uk:'ukr' };
                    if (!lang) return 'und';
                    const base = lang.split('-')[0].toLowerCase();
                    if (base.length === 3) return base;
                    return map[base] || 'und';
                };

                // Helper: clean YouTube VTT — removes duplicate word-by-word cues, sorts strictly
                const cleanVtt = (raw) => {
                    let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
                    if (!text.startsWith('WEBVTT')) text = 'WEBVTT\n\n' + text;
                    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
                    const tsToSec = (ts) => {
                        const p = ts.trim().split(':');
                        if (p.length === 3) return +p[0]*3600 + +p[1]*60 + parseFloat(p[2]);
                        return +p[0]*60 + parseFloat(p[1]);
                    };
                    const blocks = text.split(/\n\n+/);
                    const header = blocks[0];
                    const cueRe = /^([\d:.]+)\s+-->\s+([\d:.]+)/;
                    const cues = [];
                    for (let b = 1; b < blocks.length; b++) {
                        const block = blocks[b].trim();
                        if (!block) continue;
                        const lines = block.split('\n');
                        let ti = cueRe.test(lines[0]) ? 0 : 1;
                        if (ti >= lines.length) continue;
                        const m = lines[ti].match(/^([\d:.]+)\s+-->\s+([\d:.]+)/);
                        if (!m) continue;
                        const payload = lines.slice(ti+1).join('\n')
                            .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '').replace(/<\/?c>/g, '')
                            .replace(/<[^>]+>/g, '').trim();
                        if (!payload) continue;
                        cues.push({ s: tsToSec(m[1]), e: tsToSec(m[2]), t1: m[1], t2: m[2], p: payload });
                    }
                    // Deduplicate: same start time → keep last (most complete) entry
                    const seen = new Map();
                    for (const c of cues) seen.set(c.s, c);
                    const sorted = Array.from(seen.values()).sort((a, b) => a.s - b.s);
                    // Ensure strictly non-decreasing: fix any start < prev end
                    let maxE = 0;
                    for (const c of sorted) {
                        if (c.s < maxE) c.s = maxE;
                        if (c.s >= c.e) c.e = c.s + 0.001;
                        maxE = c.e;
                    }
                    if (!sorted.length) return null;
                    const f2 = (n) => String(Math.floor(n)).padStart(2,'0');
                    const toTs = (s) => `${f2(s/3600)}:${f2((s%3600)/60)}:${(s%60).toFixed(3).padStart(6,'0')}`;
                    return header + '\n\n' + sorted.map((c,i) => `${i+1}\n${toTs(c.s)} --> ${toTs(c.e)}\n${c.p}`).join('\n\n');
                };

                // Download all subtitle texts first
                const subData = [];
                for (let i = 0; i < subsToEmbed.length; i++) {
                    const sub = subsToEmbed[i];
                    if (statusInfo) statusInfo.textContent = `Fetching subtitle ${i+1}/${subsToEmbed.length}: ${sub.displayName || sub.language}...`;
                    try {
                        const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: sub.vttUrl });
                        let text = bgFetch && bgFetch.text ? bgFetch.text : null;
                        if (!text) {
                            const resp = await spoofedFetch(sub.vttUrl);
                            if (resp.ok) text = await resp.text();
                        }
                        if (text) {
                            const cleaned = cleanVtt(text);
                            if (cleaned) subData.push({ text: cleaned, language: sub.language, displayName: sub.displayName });
                        }
                    } catch (err) {
                        console.error('Failed to fetch subtitle:', sub.displayName, err);
                    }
                }


                if (statusInfo) statusInfo.textContent = 'Embedding subtitles with LibAV...';
                await embedSubtitlesWithLibAV(muxedBlob, subData, embedSubtitlesContainer, newName, downloadMethod, loadingBar);
            } else {
                await downloadAndMuxYoutube(url, targetAudio, newName, downloadMethod, loadingBar);
            }
            
            console.log("downloadFile: downloadAndMuxYoutube finished successfully.");
            finishDownloadUI(downloadId, true);
            if (subtitleUrl && !isSubtitleEmbed) {
                let subExt = '.vtt';
                if (subtitleUrl.toLowerCase().includes('fmt=srt') || subtitleUrl.toLowerCase().includes('.srt')) {
                    subExt = '.srt';
                }
                const subSettings = await browser.storage.local.get(['subtitle-conversion']);
                const subFormat = subSettings['subtitle-conversion'] || 'none';
                if (subFormat !== 'none') {
                    subExt = '.' + subFormat;
                }
                const subName = newName.replace(/\.[a-zA-Z0-9]+$/, '') + subExt;
                downloadFile(subtitleUrl, null, 'unknown', false, null, null, subName);
            }
        } catch (e) {
            console.error("downloadFile: Muxing failed", e);
            if (e.message !== "Cancelled") showDialog(browser.i18n.getMessage("downloadError", [e.message]));
            finishDownloadUI(downloadId, false);
        }
        return;
    }

    if (isStream && !bgDownloadEnabled) {
      const selectedRes = mediaDiv ? mediaDiv.dataset.selectedResolution : '';
      if (selectedRes && mediaDiv) mediaDiv.dataset.selectedResolution = selectedRes;
      loadingBar.max = 100;
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo.textContent = browser.i18n.getMessage('preparingManifest') || 'Preparing stream...';
      const result = url.toLowerCase().includes('.mpd')
        ? await downloadMPDOffline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, false, selectedRes)
        : await downloadM3U8Offline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, false, selectedRes);
      if (window.activeCancellations.has(url)) throw new Error('Cancelled');
      finishDownloadUI(downloadId, true);
      return result;
    } else if (isStream && streamPref === 'offline') {
      const selectedRes = mediaDiv ? mediaDiv.dataset.selectedResolution : '';
      loadingBar.max = 100;
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo.textContent = browser.i18n.getMessage('preparingManifest') || 'Preparing stream...';
      const streamJob = await browser.runtime.sendMessage({
        action: 'startPersistentStreamJob', url, filename: newName,
        quality: selectedRes || 'highest', request: targetRequest, downloadMethod
      });
      if (!streamJob?.success) throw new Error(streamJob?.error || 'Unable to start stream download');
      return;
    } else if (bgDownloadEnabled && downloadMethod === 'browser' && !cloudEnabled) {

      let downloadUrl = url;
      try {
        const urlObj = new URL(url);
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

      if (downloadMethod === 'browser') {
        const id = await browser.downloads.download({
          url: downloadUrl,
          filename: newName,
          saveAs: false
        });
        if (mediaDiv) mediaDiv.dataset.downloadId = id;
      } else {

        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = newName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          finishDownloadUI(downloadId, true);
        }, 1000);
      }
    } else {

      if (!bgDownloadEnabled) {

        let showNotif = false;
        let notifId = '';
        try {
          const showNotifRes = await browser.storage.local.get('fetch-notification');
          showNotif = showNotifRes['fetch-notification'] !== '0';
          notifId = 'fetch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

          if (showNotif) {
            try {
              browser.notifications.create(notifId, {
                type: "basic",
                iconUrl: browser.runtime.getURL("icons/icon.png"),
                title: (browser.i18n.getMessage("downloadingTitle") || "Downloading..."),
                message: newName
              });
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }

          const response = await spoofedFetch(url);

          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

          const contentLength = +(response.headers.get('Content-Length') || 0);

          const reader = response.body.getReader();
          let receivedLength = 0;
          let chunks = [];

          loadingBar.removeAttribute('indeterminate');
          if (contentLength > 0) loadingBar.max = contentLength;

          while(true) {
            if (window.activeCancellations.has(url)) {
              reader.cancel();
              throw new Error("Cancelled");
            }
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;

            if (contentLength > 0) {
              loadingBar.value = receivedLength;
              const percent = Math.round((receivedLength / contentLength) * 100);
              const loadedMB = (receivedLength / 1048576).toFixed(1);
              const totalMB = (contentLength / 1048576).toFixed(1);
              statusInfo.textContent = browser.i18n.getMessage("downloadPopupProgressWithSize", [percent.toString(), loadedMB, totalMB]);
            } else {
              const loadedMB = (receivedLength / 1048576).toFixed(1);
              statusInfo.textContent = browser.i18n.getMessage("downloadPopupProgressNoSize", [loadedMB]);
            }
          }

          const blob = new Blob(chunks);

          const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method'] || 'browser');
          await finalizeDownload(blob, newName, downloadMethod, loadingBar, false, false);

          if (showNotif) {
            try {
              browser.notifications.clear(notifId);
              const completeId = notifId + '_complete';
              browser.notifications.create(completeId, {
                type: "basic",
                iconUrl: browser.runtime.getURL("icons/icon.png"),
                title: browser.i18n.getMessage("downloadCompleteTitle") || "Download completed",
                message: newName
              });
              setTimeout(() => {
                try { browser.notifications.clear(completeId); } catch (e) {}
              }, 5000);
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }

          setTimeout(() => {
            finishDownloadUI(downloadId, true);
          }, 2000);
        } catch (e) {
          console.error("Popup fetch error:", e);
          if (showNotif && notifId) {
            try {
              browser.notifications.clear(notifId);
              if (e.message !== "Cancelled") {
                browser.notifications.create(notifId + '_error', {
                  type: "basic",
                  iconUrl: browser.runtime.getURL("icons/icon.png"),
                  title: "Download failed",
                  message: e.message
                });
              }
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }
          if (e.message !== "Cancelled") showDialog(browser.i18n.getMessage("downloadError", [e.message]));
          finishDownloadUI(downloadId);
        }
      } else {

        browser.runtime.sendMessage({
          action: 'startFetchDownload',
          url: url,
          downloadId: mediaDiv ? mediaDiv.dataset.downloadId : downloadId,
          filename: newName,
          request: targetRequest,
          mediaType: mediaDiv ? mediaDiv.dataset.type : getMediaType(url, targetRequest.responseHeaders)
        });
      }
    }  } catch (error) {
    showDialog(browser.i18n.getMessage("downloadError", [error.message]));
    finishDownloadUI(downloadId);
  } finally {
    if (window.activeCancellations) {
        window.activeCancellations.delete(url);
        if (audioUrl) window.activeCancellations.delete(audioUrl);
        if (downloadId) window.activeCancellations.delete(downloadId);

        const restoreCb = window.activeCancellations.restoreCallbacks.get(url);
        if (restoreCb) restoreCb();
        window.activeCancellations.restoreCallbacks.delete(url);
    }
    if (wakeLock) wakeLock.release();
  }
}

async function generateTemplateName(template, url, originalName, suggestedTitle) {
    return mediaFilename.template(template, url, originalName, suggestedTitle);
}

function showRenameDialog(initialValue) {
    return new Promise(async (resolve) => {
        const settings = await browser.storage.local.get('disable-rename-dialog');
        const isAlreadyDisabled = settings['disable-rename-dialog'] === '1';

        const dialog = document.createElement('mdui-dialog');
        dialog.headline = browser.i18n.getMessage("renameDialogHeadline") || "Download as...";

        const textField = document.createElement('mdui-text-field');
        textField.value = initialValue;
        textField.style.marginTop = '16px';
        textField.setAttribute('label', browser.i18n.getMessage("renameDialogLabel") || "Filename");
        dialog.appendChild(textField);

        let checkbox = null;
        if (!isAlreadyDisabled) {
            const checkboxContainer = document.createElement('div');
            checkboxContainer.style.marginTop = '12px';
            checkboxContainer.style.display = 'flex';
            checkboxContainer.style.alignItems = 'center';

            checkbox = document.createElement('mdui-checkbox');
            checkbox.textContent = browser.i18n.getMessage("dontShowRenameDialogCheckbox") || "Don't show this again";
            checkboxContainer.appendChild(checkbox);
            dialog.appendChild(checkboxContainer);
        }

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
            if (checkbox && checkbox.checked) {
                browser.storage.local.set({ 'disable-rename-dialog': '1' });

                const settingsSwitch = document.getElementById('disable-rename-dialog');
                if (settingsSwitch) {
                    settingsSwitch.checked = true;
                }
            }
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

document.addEventListener('DOMContentLoaded', () => {
    const extensionsMap = {
        video: [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"],
        audio: [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"],
        stream: [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"],
        subtitle: [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"],
        image: [".webp", ".png", ".jpg", ".jpeg", ".gif"],
        file: [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]
    };

    document.querySelectorAll('.info-extensions').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const type = btn.getAttribute('data-type');
            if (extensionsMap[type]) {
                let parentItem = btn.closest('.setting-item');
                let existingList = parentItem.querySelector('.inline-extension-list');
                if (existingList) {
                    existingList.remove();
                } else {
                    const titleStr = type.charAt(0).toUpperCase() + type.slice(1);
                    const listDiv = document.createElement('div');
                    listDiv.className = 'inline-extension-list';
                    listDiv.style.cssText = 'width: 100%; margin-top: 12px; padding: 12px; background: rgba(128,128,128,0.1); border-radius: 8px; font-size: 13px; line-height: 1.5; word-break: break-all;';
                    let titleText = browser.i18n.getMessage("supportedFormats");
                    if (titleText) titleText = titleText.replace('{type}', titleStr);
                    else titleText = `This extension automatically detects and supports downloading the following ${titleStr} formats:`;
                    listDiv.innerHTML = `<span style="opacity: 0.9; margin-bottom: 6px; display: block;">${titleText}</span><span style="opacity: 0.75;">${extensionsMap[type].join(', ')}</span>`;
                    parentItem.style.flexWrap = 'wrap';
                    parentItem.appendChild(listDiv);
                }
            }
        });
    });
});

function showAddManualUrlDialog() {
    return new Promise(async (resolve) => {
        const dialog = document.createElement('mdui-dialog');
        dialog.headline = browser.i18n.getMessage("addManualUrlHeadline") || "Add URL to Download";

        const urlField = document.createElement('mdui-text-field');
        urlField.style.marginTop = '16px';
        urlField.setAttribute('label', browser.i18n.getMessage("addManualUrlFieldLabel") || "Direct File URL");
        urlField.setAttribute('placeholder', "https://example.com/file.mp4");
        dialog.appendChild(urlField);

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
            resolve(urlField.value.trim());
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

async function addManualUrl(url) {
    if (!url) return;
    try {
        new URL(url);
    } catch (e) {
        showDialog("Please enter a valid URL.", "Invalid URL");
        return;
    }

    let activeTabId = null;
    let activeTabUrl = "";
    let activeTabTitle = "";
    try {
        const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs && tabs[0]) {
            activeTabId = tabs[0].id;
            activeTabUrl = tabs[0].url;
            activeTabTitle = tabs[0].title;
        }
    } catch (e) {}

    const originalName = getFileName(url, 100);
    const item = {
        url: url,
        method: 'GET',
        requestHeaders: null,
        responseHeaders: null,
        requestBody: null,
        cookie: '',
        size: 'unknown',
        timeStamp: Date.now(),
        tabId: activeTabId,
        pageTitle: originalName,
        pageUrl: activeTabUrl,
        isManual: true
    };

    const updates = {};
    updates[url] = [item];
    await browser.storage.session.set(updates);

    const loadingSpinner = document.getElementById('loading-media-list');
    if (loadingSpinner) loadingSpinner.style.display = 'block';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            credentials: 'include'
        });
        clearTimeout(timeoutId);
        if (response.body) {
            response.body.getReader().cancel().catch(() => {});
        }
    } catch (e) {
        console.warn("Manual URL probing fetch aborted or failed:", e);
    }

    await loadMediaList();

    setTimeout(async () => {
        const mediaItemEl = Array.from(document.querySelectorAll('.media-item')).find(el => {
            return el.dataset.url === url;
        });
        if (mediaItemEl) {
            const dlBtn = mediaItemEl.querySelector('#download-button');
            if (dlBtn) dlBtn.click();
        } else {
            downloadFile(url, null, null, false);
        }
    }, 300);
}

async function getM3u8BlobUrlFromMpd(mpdUrl, headers) {
  try {
    const fetchHeaders = headers ? Object.fromEntries(headers.map(h => [h.name, h.value])) : {};
    const resp = await fetch(mpdUrl, { headers: fetchHeaders });
    if (!resp.ok) throw new Error("Failed to fetch MPD");
    const mpdXmlText = await resp.text();
    
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(mpdXmlText, "application/xml");
    const NS = xmlDoc.documentElement.namespaceURI || "urn:mpeg:dash:schema:mpd:2011";
    
    const mpdBase = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);
    const mpdRoot = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0] || xmlDoc.getElementsByTagName("MPD")[0];
    const totalDurationISO = mpdRoot ? mpdRoot.getAttribute("mediaPresentationDuration") : null;
    
    const parseISODuration = d => {
      if (!d) return 0;
      const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d);
      if (!m) return 0;
      const years = parseFloat(m[1] || "0");
      const months = parseFloat(m[2] || "0");
      const days = parseFloat(m[3] || "0");
      const hours = parseFloat(m[4] || "0");
      const minutes = parseFloat(m[5] || "0");
      const secs = parseFloat(m[6] || "0");
      return (years * 365 * 24 * 3600 + months * 30 * 24 * 3600 + days * 24 * 3600 + hours * 3600 + minutes * 60 + secs);
    };
    const totalSec = parseISODuration(totalDurationISO);

    const periodList = xmlDoc.getElementsByTagNameNS(NS, "Period").length ? xmlDoc.getElementsByTagNameNS(NS, "Period") : xmlDoc.getElementsByTagName("Period");
    if (!periodList || periodList.length === 0) throw new Error("No Period found in MPD");
    const period = periodList[0];

    const baseURLNode = period.getElementsByTagNameNS(NS, "BaseURL")[0] || period.getElementsByTagName("BaseURL")[0] || (mpdRoot ? (mpdRoot.getElementsByTagNameNS(NS, "BaseURL")[0] || mpdRoot.getElementsByTagName("BaseURL")[0]) : null);
    let resolvedBase = mpdBase;
    if (baseURLNode) {
      const txt = baseURLNode.textContent.trim();
      if (txt.match(/^https?:\/\//i)) {
        resolvedBase = txt;
      } else {
        resolvedBase = new URL(txt, mpdBase).href;
      }
    }
    if (!resolvedBase.endsWith("/")) resolvedBase += "/";

    const allSets = Array.from(period.getElementsByTagNameNS(NS, "AdaptationSet").length ? period.getElementsByTagNameNS(NS, "AdaptationSet") : period.getElementsByTagName("AdaptationSet"));
    
    function getPlaylistForRepresentation(asNode, rep) {
      const repId = rep.getAttribute("id") || "";
      const bandwidth = rep.getAttribute("bandwidth") || "0";
      const width = rep.getAttribute("width");
      const height = rep.getAttribute("height");
      
      const setSegTmplNode = asNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0] || asNode.getElementsByTagName("SegmentTemplate")[0];
      const repSegTmplNode = rep.getElementsByTagNameNS(NS, "SegmentTemplate")[0] || rep.getElementsByTagName("SegmentTemplate")[0];
      const tmplNode = repSegTmplNode || setSegTmplNode;
      
      const setSegListNode = asNode.getElementsByTagNameNS(NS, "SegmentList")[0] || asNode.getElementsByTagName("SegmentList")[0];
      const repSegListNode = rep.getElementsByTagNameNS(NS, "SegmentList")[0] || rep.getElementsByTagName("SegmentList")[0];
      const listNode = repSegListNode || setSegListNode;

      let initUrl = "";
      let segmentUrls = [];
      let durations = [];

      const substituteVars = (path, extra = {}) => {
        if (!path) return "";
        return path
          .replace(/\$RepresentationID\$/g, repId)
          .replace(/\$Bandwidth\$/g, bandwidth)
          .replace(/\$Number\$/g, extra.number !== undefined ? String(extra.number) : "$Number$")
          .replace(/\$Time\$/g, extra.time !== undefined ? String(extra.time) : "$Time$");
      };

      if (tmplNode) {
        const timescale = parseInt(tmplNode.getAttribute("timescale") || "1", 10);
        const startNumber = tmplNode.getAttribute("startNumber") !== null ? parseInt(tmplNode.getAttribute("startNumber"), 10) : 1;
        const duration = parseInt(tmplNode.getAttribute("duration") || "0", 10);
        const initPattern = tmplNode.getAttribute("initialization") || "";
        const mediaPattern = tmplNode.getAttribute("media") || "";
        
        if (initPattern) {
          initUrl = new URL(substituteVars(initPattern), resolvedBase).href;
        }
        
        const timelineNode = tmplNode.getElementsByTagNameNS(NS, "SegmentTimeline")[0] || tmplNode.getElementsByTagName("SegmentTimeline")[0];
        if (timelineNode) {
          const sElems = Array.from(timelineNode.getElementsByTagNameNS(NS, "S").length ? timelineNode.getElementsByTagNameNS(NS, "S") : timelineNode.getElementsByTagName("S"));
          let cursor = null;
          let index = 0;
          for (let i = 0; i < sElems.length; i++) {
            const s = sElems[i];
            const tAttr = s.getAttribute("t");
            const dAttr = s.getAttribute("d");
            const rAttr = s.getAttribute("r");
            if (!dAttr) continue;
            const d = parseInt(dAttr, 10);
            const r = rAttr !== null ? parseInt(rAttr, 10) : 0;
            if (tAttr !== null) cursor = parseInt(tAttr, 10);
            else if (cursor === null) cursor = 0;
            
            const repeatCount = r + 1;
            for (let k = 0; k < repeatCount; k++) {
              const mediaPath = substituteVars(mediaPattern, { time: cursor, number: startNumber + index });
              segmentUrls.push(new URL(mediaPath, resolvedBase).href);
              durations.push(d / timescale);
              cursor += d;
              index++;
            }
          }
        } else if (duration > 0 && totalSec > 0) {
          const segLenSec = duration / timescale;
          const count = Math.ceil(totalSec / segLenSec);
          for (let i = 0; i < count; i++) {
            const mediaPath = substituteVars(mediaPattern, { number: startNumber + i });
            segmentUrls.push(new URL(mediaPath, resolvedBase).href);
            durations.push(segLenSec);
          }
        }
      } else if (listNode) {
        const initNode = listNode.getElementsByTagNameNS(NS, "Initialization")[0] || listNode.getElementsByTagName("Initialization")[0];
        const initPath = initNode?.getAttribute("sourceURL") || initNode?.textContent?.trim() || "";
        if (initPath) {
          initUrl = new URL(substituteVars(initPath), resolvedBase).href;
        }
        
        const timescale = parseInt(listNode.getAttribute("timescale") || "1", 10);
        const duration = parseInt(listNode.getAttribute("duration") || "0", 10);
        const segLenSec = duration / timescale;
        
        const segNodes = Array.from(listNode.getElementsByTagNameNS(NS, "SegmentURL").length ? listNode.getElementsByTagNameNS(NS, "SegmentURL") : listNode.getElementsByTagName("SegmentURL"));
        for (let i = 0; i < segNodes.length; i++) {
          const mediaPath = segNodes[i].getAttribute("media") || "";
          segmentUrls.push(new URL(substituteVars(mediaPath), resolvedBase).href);
          durations.push(segLenSec || 5);
        }
      }

      if (segmentUrls.length === 0) return null;
      
      let m3u8 = "#EXTM3U\n#EXT-X-VERSION:6\n";
      const maxDur = Math.max(...durations, 5);
      m3u8 += `#EXT-X-TARGETDURATION:${Math.ceil(maxDur)}\n`;
      m3u8 += "#EXT-X-MEDIA-SEQUENCE:1\n";
      if (initUrl) {
        m3u8 += `#EXT-X-MAP:URI="${initUrl}"\n`;
      }
      for (let i = 0; i < segmentUrls.length; i++) {
        m3u8 += `#EXTINF:${durations[i].toFixed(3)},\n${segmentUrls[i]}\n`;
      }
      m3u8 += "#EXT-X-ENDLIST\n";
      
      return {
        m3u8,
        bandwidth: parseInt(bandwidth, 10),
        width: width ? parseInt(width, 10) : null,
        height: height ? parseInt(height, 10) : null,
        id: repId
      };
    }

    let videoSet = allSets.find(as => {
      const mime = (as.getAttribute("mimeType") || "").toLowerCase();
      const type = (as.getAttribute("contentType") || "").toLowerCase();
      return mime.startsWith("video/") || type === "video";
    });
    let audioSet = allSets.find(as => {
      const mime = (as.getAttribute("mimeType") || "").toLowerCase();
      const type = (as.getAttribute("contentType") || "").toLowerCase();
      return mime.startsWith("audio/") || type === "audio";
    });
    
    if (!videoSet && allSets.length > 0) {
      videoSet = allSets[0];
    }
    
    let audioPlay = null;
    if (audioSet) {
      const audioReps = Array.from(audioSet.getElementsByTagNameNS(NS, "Representation").length ? audioSet.getElementsByTagNameNS(NS, "Representation") : audioSet.getElementsByTagName("Representation"));
      if (audioReps.length > 0) {
        audioPlay = getPlaylistForRepresentation(audioSet, audioReps[0]);
      }
    }

    const videoPlays = [];
    if (videoSet) {
      const videoReps = Array.from(videoSet.getElementsByTagNameNS(NS, "Representation").length ? videoSet.getElementsByTagNameNS(NS, "Representation") : videoSet.getElementsByTagName("Representation"));
      videoReps.forEach(rep => {
        const play = getPlaylistForRepresentation(videoSet, rep);
        if (play) {
          videoPlays.push(play);
        }
      });
    }
    
    if (videoPlays.length === 0 && !audioPlay) throw new Error("Could not parse any media track from MPD");
    
    if (videoPlays.length > 0 && audioPlay) {
      const audioBlob = new Blob([audioPlay.m3u8], { type: "application/x-mpegURL" });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      let master = "#EXTM3U\n#EXT-X-VERSION:6\n";
      master += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${audioUrl}"\n`;
      
      videoPlays.forEach(vp => {
        const videoBlob = new Blob([vp.m3u8], { type: "application/x-mpegURL" });
        const videoUrl = URL.createObjectURL(videoBlob);
        let streamInf = `#EXT-X-STREAM-INF:BANDWIDTH=${vp.bandwidth || 1000000},AUDIO="audio"`;
        if (vp.width && vp.height) {
          streamInf += `,RESOLUTION=${vp.width}x${vp.height}`;
        }
        master += `\n${streamInf}\n${videoUrl}\n`;
      });
      
      return URL.createObjectURL(new Blob([master], { type: "application/x-mpegURL" }));
    } else if (videoPlays.length > 0) {
      let master = "#EXTM3U\n#EXT-X-VERSION:6\n";
      videoPlays.forEach(vp => {
        const videoBlob = new Blob([vp.m3u8], { type: "application/x-mpegURL" });
        const videoUrl = URL.createObjectURL(videoBlob);
        let streamInf = `#EXT-X-STREAM-INF:BANDWIDTH=${vp.bandwidth || 1000000}`;
        if (vp.width && vp.height) {
          streamInf += `,RESOLUTION=${vp.width}x${vp.height}`;
        }
        master += `\n${streamInf}\n${videoUrl}\n`;
      });
      return URL.createObjectURL(new Blob([master], { type: "application/x-mpegURL" }));
    } else {
      const blob = new Blob([audioPlay.m3u8], { type: "application/x-mpegURL" });
      return URL.createObjectURL(blob);
    }
  } catch (e) {
    console.error("Error in getM3u8BlobUrlFromMpd:", e);
    return mpdUrl;
  }
}
