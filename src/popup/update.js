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



async function muatUlangKacaAbout() {
  try {
    await ensureScriptLoaded('popup/about.js', 'loadAboutPage');
    if (typeof window.loadAboutPage === 'function') await window.loadAboutPage();
  } catch (error) {
    console.warn('Gagal muat ulang kaca About:', error);
  }
}

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
        window._wmd_latest_update = {
          updateAvailable: true,
          latestVersion: result.version || 'new',
          updateUrl: AMO_URL
        };
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
        window._wmd_latest_update = {
          updateAvailable: true,
          latestVersion: result.latestVersion,
          updateUrl: result.updateUrl,
          amoVersion: result.amoVersion || null,
        };
        navigationPageLoads.delete("about");
        if (typeof currentNavigationTab !== "undefined" && currentNavigationTab === "about") {
          muatUlangKacaAbout();
        }
      }
    } catch (error) {
      console.error('Update check failed:', error);
    }
  } else {
    navigationPageLoads.delete("about");
    if (typeof currentNavigationTab !== "undefined" && currentNavigationTab === "about") {
      muatUlangKacaAbout();
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

async function getSpecificReleaseUrl(version, isFirefox = false) {
  const RELEASES_API_URL = 'https://api.github.com/repos/anpa26/website-media-downloader/releases';
  try {
    const res = await fetch(RELEASES_API_URL + '?per_page=20&t=' + Date.now());
    if (!res.ok) return null;
    const releases = await res.json();
    const tagSigned = 'v' + version + '-signed';
    const tagStandard = 'v' + version;

    if (isFirefox) {
      const signedRelease = releases.find(r => r.tag_name === tagSigned && !r.draft);
      if (signedRelease) return signedRelease.html_url;
      return null;
    }

    const targetTags = [tagSigned, tagStandard];
    for (const tag of targetTags) {
      const latest = releases.find(r => r.tag_name === tag && !r.prerelease && !r.draft);
      if (latest) return latest.html_url;
      const prerelease = releases.find(r => r.tag_name === tag && r.prerelease && !r.draft);
      if (prerelease) return prerelease.html_url;
    }
  } catch (e) {
    console.warn('Failed to fetch specific release URL:', e);
  }
  return null;
}

async function performUpdateCheck() {
  const ABOUT_URL = 'https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1/src/about.json';
  const AMO_URL = 'https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader';
  const AMO_API_URL = 'https://addons.mozilla.org/api/v5/addons/addon/website-media-downloader/';

  const currentVersion = browser.runtime.getManifest().version;
  let localAboutVersion = null;
  try {
    const localAboutRes = await fetch(browser.runtime.getURL('about.json?t=' + Date.now()));
    if (localAboutRes.ok) {
      const localAbout = await localAboutRes.json();
      localAboutVersion = localAbout?.extension?.version || null;
    }
  } catch (e) {
    console.warn('Failed to read local about.json, falling back to manifest version:', e);
  }
  if (!localAboutVersion) localAboutVersion = currentVersion;
  const isFirefox = navigator.userAgent.includes('Firefox') || (typeof browser !== 'undefined' && browser.runtime.getURL && browser.runtime.getURL('').startsWith('moz-extension://'));

  if (isFirefox) {
    let githubVersion = null;
    let amoVersion = null;

    try {
      const [githubRes, amoRes] = await Promise.all([
        fetch(ABOUT_URL + '?t=' + Date.now()).then(r => r.ok ? r.json() : null),
        fetch(AMO_API_URL + '?t=' + Date.now()).then(r => r.ok ? r.json() : null)
      ]);

      if (githubRes) githubVersion = githubRes.extension?.version || null;
      if (amoRes && amoRes.current_version) amoVersion = amoRes.current_version.version;
    } catch (e) {
      console.warn("Parallel fetch failed, trying fallbacks:", e);
    }

    if (!githubVersion) {
      try {
        const res = await fetch(ABOUT_URL + '?t=' + Date.now());
        if (res.ok) {
          const data = await res.json();
          githubVersion = data.extension?.version || null;
        }
      } catch (e) {
        console.error("Fallback GitHub fetch failed:", e);
      }
    }

    if (!githubVersion) {
      throw new Error("Failed to check for updates");
    }

    if (compareVersions(githubVersion, localAboutVersion) > 0) {
      let requireUninstall = false;
      try {
        const changelogRes = await fetch('https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1/src/changelog.json?t=' + Date.now());
        if (changelogRes.ok) {
          const data = await changelogRes.json();
          requireUninstall = !!data.require_uninstall;
        }
      } catch (e) {}

      if (amoVersion && compareVersions(amoVersion, githubVersion) >= 0) {
        return { updateAvailable: true, latestVersion: githubVersion, updateUrl: AMO_URL, amoVersion, requireUninstall };
      } else {
        const specificUrl = await getSpecificReleaseUrl(githubVersion, true);
        if (specificUrl) {
          return { updateAvailable: true, latestVersion: githubVersion, updateUrl: specificUrl, amoVersion, requireUninstall };
        }
      }
    }
  } else {
    try {
      const response = await fetch(ABOUT_URL + '?t=' + Date.now());
      if (response.ok) {
        const data = await response.json();
        const githubVersion = data.extension?.version || null;
        if (githubVersion && compareVersions(githubVersion, localAboutVersion) > 0) {
          let requireUninstall = false;
          try {
            const changelogRes = await fetch('https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1/src/changelog.json?t=' + Date.now());
            if (changelogRes.ok) {
              const data = await changelogRes.json();
              requireUninstall = !!data.require_uninstall;
            }
          } catch (e) {}
          const specificUrl = await getSpecificReleaseUrl(githubVersion, false);
          if (specificUrl) {
            return { updateAvailable: true, latestVersion: githubVersion, updateUrl: specificUrl, amoVersion: null, requireUninstall };
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
