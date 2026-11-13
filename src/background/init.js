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


browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        const defaults = {
            'download-method': 'fetch',
            'mime-detection': '1',
            'url-detection': '1',
            'media-cache': '1',
            'history-page': '0',
            'detect-download-links': '1',
            'disable-deduplication': '1',
            'auto-download-media': '0',
            'auto-download-all-domains': '0',
            'auto-ignore-excluded-media': '1',
            'auto-download-video': '1',
            'auto-download-stream': '1',
            'open-preference': 'popup'
        };
        await browser.storage.local.set(defaults);

        browser.tabs.create({
            url: 'https://wmd.devianproject.tech/welcome',
        });
    } else if (details.reason === 'update') {
        await browser.storage.local.set({ 'wmd_previous_version': details.previousVersion || 'unknown' });
    }
});

initListener();

restoreActiveDownloadsFromSession();

browser.storage.local.get('open-preference', function (result) {
    if (result['open-preference'] === 'popup' || result['open-preference'] === undefined) {
        browser.action.setPopup({ popup: 'pages/popup.html' });
    } else {
        browser.action.setPopup({ popup: '' });
    }
});

browser.runtime.onMessage.addListener((message, sender) => {
    if (!isTrustedExtensionSender(sender)) return;
    if (message.action === 'clearStorage') {

        const activeUrls = new Set();
        for (const [key, value] of activeDownloads) {
            if (value.url) activeUrls.add(value.url);
        }

        antreTulisSession(async () => {
            const items = await browser.storage.session.get(null);
            const keysToRemove = [];
            for (const url in items) {
                if (url === 'urlToHeaderMap') continue;
                if (!activeUrls.has(url)) {
                    keysToRemove.push(url);
                }
            }
            if (keysToRemove.length > 0) {
                await browser.storage.session.remove(keysToRemove);
            }
        }).catch(() => {});

        openCacheDB().then(db => {
            const activeKeys = new Set();
            for (const [key, value] of activeDownloads) {
                activeKeys.add(key);
                if (value.url) activeKeys.add(value.url);
            }
            for (const dlIds of downloadTabs.values()) {
                if (dlIds instanceof Set) {
                    for (const dlId of dlIds) {
                        activeKeys.add(dlId);
                    }
                } else if (dlIds) {
                    activeKeys.add(dlIds);
                }
            }
            for (const item of pendingSaveQueue) {
                if (item.id) activeKeys.add(item.id);
                if (item.url) activeKeys.add(item.url);
            }

            const tx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const chunkStore = tx.objectStore(CHUNK_STORE_NAME);

            store.openCursor().onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const key = cursor.key;
                    if (!activeKeys.has(key)) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };

            chunkStore.openCursor().onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const downloadId = cursor.key[0];
                    if (!activeKeys.has(downloadId)) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };
        }).catch(e => {
            console.error("Failed to clear IndexedDB cache:", e);
        });
    } else if (message.action === 'removeMedia') {
        if (message.url) {
            antreTulisSession(() => browser.storage.session.remove(message.url)).catch(() => {});
        }
    }
});

browser.action.onClicked.addListener((tab) => {
    browser.storage.local.get('open-preference', function (result) {
        if (result['open-preference'] !== 'window') {

            browser.tabs.create({
                url: browser.runtime.getURL(`pages/popup.html?mode=tab`),
            });
        } else {

            browser.windows.create({
                url: browser.runtime.getURL(`pages/popup.html?mode=window`),
                type: 'popup',
                width: 800,
                height: 600,
            });
        }
    });
});

browser.runtime.onStartup.addListener(initListener);

if (browser.runtime.setUninstallURL) {
    try {
        browser.runtime.setUninstallURL('https://wmd.devianproject.tech/goodbye');
    } catch (e) {
        console.warn('Failed to set uninstall URL:', e);
    }
}


browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    getSettings(function(newSettings) {
        cachedSettings = newSettings;
        if (Object.prototype.hasOwnProperty.call(changes, 'mime-detection') || Object.prototype.hasOwnProperty.call(changes, 'url-detection')) {
            initListener(true);
            if (newSettings.mimeDetection || newSettings.urlDetection || newSettings.youtubeDetection) loadPersistentHeaders();
            if (mediaCacheEnabled && (newSettings.mimeDetection || newSettings.urlDetection)) attachCacheListener();
            else detachCacheListener();
        }
        if (Object.prototype.hasOwnProperty.call(changes, 'youtube-detection') && newSettings.youtubeDetection) loadPersistentHeaders();
        if (Object.keys(changes).some(key => AUTO_DOWNLOAD_RESCAN_KEYS.has(key))) {
            scheduleExistingMediaAutoDownload(newSettings);
        }
        if (newSettings.ignoreDisabledTypes) {
            antreTulisSession(async () => {
                const items = await browser.storage.session.get(null);
                const keysToRemove = [];
                for (const [url, requests] of Object.entries(items || {})) {
                    const contentType = (requests && requests.length > 0 && requests[0].responseHeaders)
                        ? (requests[0].responseHeaders.find(h => h.name && h.name.toLowerCase() === 'content-type')?.value || '')
                        : '';
                    const mType = getMediaType(url, contentType);
                    if (isMediaTypeDisabled(mType, newSettings)) {
                        keysToRemove.push(url);
                    }
                }
                if (keysToRemove.length > 0) {
                    await browser.storage.session.remove(keysToRemove);
                }
            }).catch(() => {});
        }
    });

    if (Object.prototype.hasOwnProperty.call(changes, 'media-cache')) {
        const newEnabled = !!isFlagEnabled(changes['media-cache'].newValue);
        if (newEnabled !== mediaCacheEnabled) {
            mediaCacheEnabled = newEnabled;
            if (mediaCacheEnabled && (cachedSettings.mimeDetection || cachedSettings.urlDetection)) {
                attachCacheListener();
            } else {
                detachCacheListener();
            }
        }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'open-preference')) {
        const newVal = changes['open-preference'].newValue;
        if (newVal === 'popup') {
            browser.action.setPopup({ popup: 'pages/popup.html' });
        } else {
            browser.action.setPopup({ popup: '' });
        }
    }
});


browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes['speed-boost-resume'] || changes['speed-boost'])) {
        browser.storage.local.get(['speed-boost', 'speed-boost-resume']).then(settings => {
            const speedBoostEnabled = settings['speed-boost'] === '1';
            const speedBoostResumeEnabled = settings['speed-boost-resume'] === '1';

            for (const [id, info] of activeDownloads) {
                if (info.isZip || info.isHls || !info.abortController || info.isPaused) continue;

                const shouldBeParallel = info.isParallel; 
                let desiredParallel = false;

                if (!info.isManualResume) {
                    
                    desiredParallel = speedBoostEnabled;
                } else {
                    
                    desiredParallel = speedBoostEnabled && speedBoostResumeEnabled;
                }

                if (shouldBeParallel !== desiredParallel) {
                    console.log(`[Hot-Swap] Download ${id}: ${shouldBeParallel} -> ${desiredParallel}`);
                    const lastLoaded = info.loaded;
                    info.abortController.abort();

                    setTimeout(() => {
                        handleFetchDownload(info.url, info.filename, info.originalRequest, id, true, info.isManualResume, lastLoaded, info.mediaType);
                    }, 50);
                }
            }
        });
    }
});

