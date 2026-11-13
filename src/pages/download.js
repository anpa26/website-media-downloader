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

function escapeHtmlDownload(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    s.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(s);
  });
}
