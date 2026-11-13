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



function prioritizeActiveDownload(element) {
  if (!element) return;
  if (activeDownloadingElements.includes(element)) return;
  activeDownloadingElements.push(element);
  const container = document.getElementById('media-list');
  if (!container || element.parentElement !== container) return;

  // Keep active downloads in their current order, ahead of idle media.
  const activeSet = new Set(activeDownloadingElements);
  const firstIdle = [...container.children].find(child => !activeSet.has(child));
  if (firstIdle && [...container.children].indexOf(element) >
      [...container.children].indexOf(firstIdle)) {
    container.insertBefore(element, firstIdle);
  }
}

function getActiveRequests() {
  return (isGroupingEnabled && activeGroup !== null)
    ? allFilteredRequests.filter(item => item.type === activeGroup)
    : allFilteredRequests;
}

async function spoofedFetch(url, options = {}) {
  try {
    const headers = await browser.runtime.sendMessage({ action: 'getSpoofedHeaders', url: url });
    if (headers) {
      options.headers = options.headers || {};
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
  }
  return fetch(url, options);
}
