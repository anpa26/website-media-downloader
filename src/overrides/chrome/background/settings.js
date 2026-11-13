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

function networkDetectionEnabled(_details, settings = cachedSettings) {
    return !!(settings.mimeDetection || settings.urlDetection);
}

function getSettings(callback) {
    browser.storage.local.get([
        'manual-scan', 'remove-on-tab-close', 'mime-detection', 'url-detection', 'detect-download-links', 'media-notification', 'media-system-notification', 'stack-notifications', 'hide-segments', 'hide-page-components',
        'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file', 'ignore-disabled-types', 'optimize-low-end',
        'auto-download-media', 'auto-download-quality', 'background-download', 'auto-download-all-domains', 'auto-download-domains', 'auto-skip-download-names', 'auto-skip-download-names-only', 'auto-skip-download-domains', 'auto-ignore-excluded-media', 'auto-download-video', 'auto-download-stream',
        'filename-template', 'theme-color', 'ui-scale'
    ], function (result) {
        const s = {
            manualScan: isFlagEnabled(result['manual-scan'], false),
            removeOnTabClose: isFlagEnabled(result['remove-on-tab-close'], false),
            mimeDetection: isFlagEnabled(result['mime-detection'], true),
            urlDetection: isFlagEnabled(result['url-detection'], true),
            detectDownloadLinks: isFlagEnabled(result['detect-download-links'], true),
            mediaNotification: isFlagEnabled(result['media-notification'], true),
            mediaSystemNotification: isFlagEnabled(result['media-system-notification'], true),
            stackNotifications: isFlagEnabled(result['stack-notifications'], false),
            hideSegments: isFlagEnabled(result['hide-segments'], false),
            hidePageComponents: isFlagEnabled(result['hide-page-components'], true),
            onlyVideo: isFlagEnabled(result['only-video'], true),
            onlyAudio: isFlagEnabled(result['only-audio'], true),
            onlyStream: isFlagEnabled(result['only-stream'], true),
            onlyImage: isFlagEnabled(result['only-image'], true),
            onlySubtitle: isFlagEnabled(result['only-subtitle'], true),
            onlyFile: isFlagEnabled(result['only-file'], true),
            ignoreDisabledTypes: isFlagEnabled(result['ignore-disabled-types'], false),
            optimizeLowEnd: isFlagEnabled(result['optimize-low-end'], false),
            autoDownloadMedia: isFlagEnabled(result['auto-download-media'], false),
            autoDownloadQuality: result['auto-download-quality'] || 'highest',
            backgroundDownload: isFlagEnabled(result['background-download'], true),
            autoDownloadAllDomains: isFlagEnabled(result['auto-download-all-domains'], false),
            autoSkipDownloadNames: result['auto-skip-download-names'] || '',
            autoSkipDownloadNamesOnly: isFlagEnabled(result['auto-skip-download-names-only'], false),
            autoSkipDownloadDomains: result['auto-skip-download-domains'] || '',
            autoIgnoreExcludedMedia: isFlagEnabled(result['auto-ignore-excluded-media'], true),
            autoDownloadDomains: result['auto-download-domains'] || '',
            autoDownloadVideo: isFlagEnabled(result['auto-download-video'], true),
            autoDownloadStream: isFlagEnabled(result['auto-download-stream'], true),
            filenameTemplate: (result['filename-template'] && result['filename-template'] !== '0') ? result['filename-template'] : '',
            themeColor: result['theme-color'] ? (result['theme-color'].startsWith('#') || result['theme-color'].startsWith('rgb') ? result['theme-color'] : '#' + result['theme-color']) : '#bbdefb',
            uiScale: result['ui-scale'] || '85%'
        };
        cachedSettings = s;
        if (callback) callback(s);
    });
}

function isMediaTypeDisabled(mediaType, settings) {
    const activeSettings = settings || cachedSettings;
    const isIgnoreDisabled = activeSettings.ignoreDisabledTypes || activeSettings.optimizeLowEnd;
    if (!mediaType || !activeSettings || !isIgnoreDisabled) return false;
    if (mediaType === 'video' && !activeSettings.onlyVideo) return true;
    if (mediaType === 'audio' && !activeSettings.onlyAudio) return true;
    if (mediaType === 'stream' && !activeSettings.onlyStream) return true;
    if (mediaType === 'image' && !activeSettings.onlyImage) return true;
    if (mediaType === 'subtitle' && !activeSettings.onlySubtitle) return true;
    if (mediaType === 'file' && !activeSettings.onlyFile) return true;
    return false;
}

const notificationUrls = new Map();
const notifiedUrls = new Map();
const lastNotificationTime = new Map();
const tabsWithDrm = new Set();

browser.tabs.onRemoved.addListener((tabId) => {
    const removedMeta = tabMetadata.get(tabId);
    let removedHost = '';
    try { if (removedMeta?.url) removedHost = new URL(removedMeta.url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) {}
    tabMetadata.delete(tabId);
    tabsWithDrm.delete(tabId);
    notifiedUrls.delete(tabId);
    lastNotificationTime.delete(tabId);

    getSettings((settings) => {
        if (!settings.removeOnTabClose) return;
        antreTulisSession(async () => {
            const items = await browser.storage.session.get(null);
            if (!items) return;
            let otherSameHostOpen = false;
            if (removedHost) {
                try {
                    const openTabs = await browser.tabs.query({}).catch(() => []);
                    otherSameHostOpen = (openTabs || []).some(t => {
                        if (!t || t.id === tabId || !t.url) return false;
                        try {
                            return new URL(t.url).hostname.toLowerCase().replace(/^www\./, '') === removedHost;
                        } catch (e) { return false; }
                    });
                } catch (e) {}
            }
            const keysToRemove = [];
            const updates = {};
            for (const [url, reqs] of Object.entries(items)) {
                if (!Array.isArray(reqs) || !reqs.length) continue;
                const remaining = reqs.filter(r => {
                    if (!r) return false;
                    if (r.isManual) return true;
                    if (r.tabId === tabId) return false;
                    if (removedHost && !otherSameHostOpen && (r.tabId == null || r.tabId < 0) && r.pageUrl) {
                        try {
                            if (new URL(r.pageUrl).hostname.toLowerCase().replace(/^www\./, '') === removedHost) return false;
                        } catch (e) {}
                    }
                    return true;
                });
                if (remaining.length === 0) {
                    keysToRemove.push(url);
                } else if (remaining.length !== reqs.length) {
                    updates[url] = remaining;
                }
            }
            const ops = [];
            if (keysToRemove.length > 0) ops.push(browser.storage.session.remove(keysToRemove).catch(() => {}));
            if (Object.keys(updates).length > 0) ops.push(browser.storage.session.set(updates).catch(() => {}));
            if (ops.length > 0) {
                await Promise.all(ops);
                browser.runtime.sendMessage({ action: 'mediaRemovedOnTabClose' }).catch(() => {});
            }
        }).catch(() => {});
    });
});

if (browser.tabs.onActivated) {
    browser.tabs.onActivated.addListener(() => { updateActiveDownloadsBadge().catch(() => {}); });
}

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
        tabMetadata.set(tabId, { title: changeInfo.title || tabMetadata.get(tabId)?.title || '', url: changeInfo.url });
    }
    if (changeInfo.status === 'loading') {
        notifiedUrls.delete(tabId);
        lastNotificationTime.delete(tabId);
        tabsWithDrm.delete(tabId);
        antreTulisSession(async () => {
            const items = await browser.storage.session.get(null);
            const updates = {};
            for (const [url, reqs] of Object.entries(items || {})) {
                if (!Array.isArray(reqs) || !reqs.length) continue;
                let changed = false;
                reqs.forEach(r => {
                    if (r && r.tabId === tabId && r.manualScanned && !r.isManual) {
                        r.manualScanned = false;
                        changed = true;
                    }
                });
                if (changed) updates[url] = reqs;
            }
            if (Object.keys(updates).length > 0) await browser.storage.session.set(updates);
        }).catch(() => {});
    }
});

let nomerBadge = 0;
async function updateActiveDownloadsBadge() {
    const nomerku = ++nomerBadge;
    try {
        const settings = await browser.storage.local.get('badge-counter');
        const actionAPI = (typeof browser !== 'undefined' && browser.action) ? browser.action : (typeof chrome !== 'undefined' && chrome.action) ? chrome.action : (browser.browserAction || chrome.browserAction);
        if (!actionAPI || !actionAPI.setBadgeText) return;

        if (settings['badge-counter'] === '0') {
            if (nomerku !== nomerBadge) return;
            actionAPI.setBadgeText({ text: '' });
            return;
        }

        let activeCount = 0;
        if (typeof activeDownloads !== 'undefined' && activeDownloads) {
            for (const item of activeDownloads.values()) {
                if (isActivelyDownloading(item)) {
                    activeCount++;
                }
            }
        }

        let text = activeCount > 0 ? (activeCount > 99 ? '99+' : String(activeCount)) : '';
        if (nomerku !== nomerBadge) return;
        actionAPI.setBadgeText({ text: text });
        if (text && actionAPI.setBadgeBackgroundColor) {
            actionAPI.setBadgeBackgroundColor({ color: activeCount > 0 ? '#1976D2' : '#3B82F6' });
        }
    } catch (e) {
        console.warn("Failed to update active downloads badge:", e);
    }
}

function isActivelyDownloading(item) {
    if (!item || item.paused || item.isPaused || item.cancelled || item.isCachedSave) return false;
    const state = String(item.state || '').trim().toLowerCase();
    const status = String(item.status || item.statusText || '').trim().toLowerCase();
    const terminalStates = new Set(['complete', 'completed', 'failed', 'error', 'interrupted', 'cancelled', 'canceled', 'paused']);
    if (terminalStates.has(state) || terminalStates.has(status)) return false;
    return !/^(complete(?:d)?|failed|error|interrupted|cancel(?:led|ed)|paused)(?:\b|!)/.test(status);
}

const _origActiveDownloadsSet = activeDownloads.set.bind(activeDownloads);
const _origActiveDownloadsDelete = activeDownloads.delete.bind(activeDownloads);
const _origActiveDownloadsClear = activeDownloads.clear.bind(activeDownloads);

function saveActiveDownloadsToSession() {
    const storageSession = (typeof browser !== 'undefined' && browser.storage && browser.storage.session) ? browser.storage.session : (typeof browser !== 'undefined' && browser.storage ? browser.storage.local : null);
    if (!storageSession) return;

    const list = [];
    for (let [id, val] of activeDownloads) {
        list.push({
            id: id,
            url: val.url,
            filename: val.filename,
            loaded: val.loaded || 0,
            total: val.total || 0,
            isParallel: !!val.isParallel,
            isPaused: !!val.isPaused,
            isNative: !!val.isNative,
            mediaType: val.mediaType,
            percent: val.percent,
            status: val.status,
            groupType: val.groupType || null
        });
    }
    storageSession.set({ wmd_active_downloads: list }).catch(() => {});
}

function restoreActiveDownloadsFromSession() {
    const storageSession = (typeof browser !== 'undefined' && browser.storage && browser.storage.session) ? browser.storage.session : (typeof browser !== 'undefined' && browser.storage ? browser.storage.local : null);
    if (!storageSession) return;

    storageSession.get('wmd_active_downloads').then(async res => {
        const list = res.wmd_active_downloads;
        if (list && Array.isArray(list)) {
            let statusAsli = {};
            try {
                const kabeh = await golekiDownload({});
                for (const d of kabeh || []) statusAsli[d.id] = d.state;
            } catch (_) {}
            list.forEach(val => {
                if (activeDownloads.has(val.id)) return;
                if (val.isNative && typeof val.url === 'string' && val.url.startsWith('blob:') && !(val.loaded > 0)) return;
                const statusNormal = String(val.status || '').trim().toLowerCase();
                const sudahSelesai = statusNormal === 'complete' || statusNormal === 'completed' ||
                    (val.percent !== null && val.percent !== undefined && val.percent >= 100) ||
                    ((val.total || 0) > 0 && (val.loaded || 0) >= (val.total || 0));
                if (!val.isPaused && !sudahSelesai) {
                    if (!val.isNative) return;
                    const stateAsli = statusAsli[val.id];
                    if (!stateAsli || stateAsli !== 'in_progress') return;
                    val.state = stateAsli;
                }
                _origActiveDownloadsSet(val.id, val);
            });
            updateActiveDownloadsBadge();
        }
    }).catch(() => {});
}

activeDownloads.set = function(key, value) {
    const res = _origActiveDownloadsSet(key, value);
    updateActiveDownloadsBadge();
    saveActiveDownloadsToSession();
    return res;
};

activeDownloads.delete = function(key) {
    const res = _origActiveDownloadsDelete(key);
    updateActiveDownloadsBadge();
    saveActiveDownloadsToSession();
    return res;
};

activeDownloads.clear = function() {
    const res = _origActiveDownloadsClear();
    updateActiveDownloadsBadge();
    saveActiveDownloadsToSession();
    return res;
};

if (browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes['badge-counter']) {
            updateActiveDownloadsBadge();
        }
    });
}

