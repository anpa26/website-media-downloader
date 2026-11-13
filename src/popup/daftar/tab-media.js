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



async function getTargetMediaTab() {
  const isWebTab = (t) => t && t.url && /^https?:/i.test(t.url);
  const activeTabs = await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (activeTabs && isWebTab(activeTabs[0])) {
    return activeTabs[0];
  }
  const allTabs = await browser.tabs.query({}).catch(() => []);
  const webTabs = (allTabs || []).filter(isWebTab);
  if (webTabs.length > 0) {
    webTabs.sort((a, b) => (b.lastAccessed || b.index || 0) - (a.lastAccessed || a.index || 0));
    return webTabs[0];
  }
  if (activeTabs && activeTabs[0] && !/^(moz|chrome)-extension:/i.test(activeTabs[0].url || '')) {
    return activeTabs[0];
  }
  return null;
}

async function updateMissingImageSizes(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  const settings = await browser.storage.local.get(['hide-image-without-size', 'manual-scan']);
  const manualScanMode = isFlagEnabled(settings['manual-scan'], false);
  let hiddenImageBecameVisible = false;
  for (const url of new Set(urls)) {
    const mediaRequests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url });
    const requests = mediaRequests?.[url];
    if (manualScanMode) {
      const anyScanned = Array.isArray(requests) && requests.some(r => r && (r.manualScanned || r.isManual));
      if (!anyScanned) continue;
    }
    const item = Array.from(document.querySelectorAll('.media-item[data-type="image"]'))
      .find(element => element.dataset.originalUrl === url);
    if (!item) {
      hiddenImageBecameVisible = isFlagEnabled(settings['hide-image-without-size'], false);
      continue;
    }
    if (parseInt(item.dataset.size, 10) > 0) continue;
    if (!Array.isArray(requests)) continue;
    const size = requests.reduce((largest, request) => Math.max(largest, parseInt(request.size, 10) || 0), 0);
    if (size <= 0) continue;
    item.dataset.size = String(size);
    const description = item.querySelector('.media-description');
    if (!description) continue;
    description.textContent = `${description.dataset.mediaHost || ''} • ${getHumanReadableSize(size)}${description.dataset.mediaResolution || ''} • ${description.dataset.mediaTime || ''}`;
  }
  if (hiddenImageBecameVisible) loadMediaList().catch(() => {});
}
