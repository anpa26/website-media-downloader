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

const tabMetadata = new Map(); // tabId -> { title, url }


const isSessionShimActive = !browser.storage.session;
if (isSessionShimActive) {
    browser.storage.session = {
        get: (keys, cb) => browser.storage.local.get(keys, cb),
        set: (obj, cb) => browser.storage.local.set(obj, cb),
        remove: (keys, cb) => browser.storage.local.remove(keys, cb),
        clear: (cb) => browser.storage.local.clear(cb)
    };
    if (browser.runtime.onStartup) {
        browser.runtime.onStartup.addListener(async () => {
            try {
                const all = await browser.storage.local.get(null);
                const mediaKeys = Object.keys(all || {}).filter(k => /^(https?:|blob:|data:)/i.test(k) || k === 'wmd_active_downloads' || k === 'urlToHeaderMap');
                if (mediaKeys.length) await browser.storage.local.remove(mediaKeys);
                urlToHeaderMap.clear();
                activeDownloads.clear();
            } catch (_) {}
        });
    }
}

let urlList = [];
let headersSentListener, headersReceivedListener;
const activeDownloads = new Map();

