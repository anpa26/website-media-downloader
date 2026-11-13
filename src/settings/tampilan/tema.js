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





const getRedirectURL = () => {
    if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
        return browser.identity.getRedirectURL();
    }
    const id = browser.runtime.id;
    if (id && id.includes('@')) {
        return `https://${encodeURIComponent(id)}.extensions.allizom.org/`;
    }
    return "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
};

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
