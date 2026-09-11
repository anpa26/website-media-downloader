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

if (typeof importScripts === 'function') importScripts('detection_exclusions.js', 'media_filename.js');

const tabMetadata = new Map(); // tabId -> { title, url }

const m3u8VariantsCacheBg = new Map();

async function getM3U8VariantsBg(url) {
    if (m3u8VariantsCacheBg.has(url)) {
        return m3u8VariantsCacheBg.get(url);
    }
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const text = await response.text();
        if (!text.includes("#EXT-X-STREAM-INF")) {
            m3u8VariantsCacheBg.set(url, []);
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
                let uri = lines[i + 1];
                if (uri) {
                    uri = uri.trim();
                    variants.push({
                        bandwidth,
                        resolution,
                        uri: uri.startsWith("http") ? uri : baseUrl + uri
                    });
                }
            }
        }
        m3u8VariantsCacheBg.set(url, variants);
        return variants;
    } catch (e) {
        console.warn("Failed to parse variants for", url, e);
        m3u8VariantsCacheBg.set(url, []);
        return [];
    }
}

let clientZipLoadPromise = null;
async function ensureClientZipLoaded() {
    if (typeof downloadZip !== 'undefined') return;
    if (!clientZipLoadPromise) {
        clientZipLoadPromise = Promise.resolve().then(() => {
            importScripts('libraries/client-zip.js');
            if (typeof downloadZip === 'undefined') throw new Error('client-zip.js did not expose downloadZip');
        }).catch(error => {
            clientZipLoadPromise = null;
            throw error;
        });
    }
    return clientZipLoadPromise;
}

if (!browser.storage.session) {
    browser.storage.session = {
        get: (keys, cb) => browser.storage.local.get(keys, cb),
        set: (obj, cb) => browser.storage.local.set(obj, cb),
        remove: (keys, cb) => browser.storage.local.remove(keys, cb),
        clear: (cb) => browser.storage.local.clear(cb)
    };
}

let urlList = [];
let headersSentListener, headersReceivedListener;
const activeDownloads = new Map();

async function saveDownloadState(downloadId, data) {
    const res = await browser.storage.local.get('pending-downloads');
    const pending = res['pending-downloads'] || {};
    pending[downloadId] = {
        url: data.url,
        filename: data.filename,
        total: parseInt(data.total) || 0,
        loaded: parseInt(data.loaded) || 0,
        originalRequest: data.originalRequest,
        chunkIndex: data.chunkIndex || 0,
        timestamp: Date.now(),
        isParallel: !!data.isParallel,
        isPaused: data.isPaused === true || data.isPaused === 'true',
        dropboxSessionId: data.dropboxSessionId,
        mediaType: data.mediaType || getMediaType(data.url, [])
    };
    await browser.storage.local.set({ 'pending-downloads': pending });
}

async function removeDownloadState(downloadId) {
    const res = await browser.storage.local.get('pending-downloads');
    const pending = res['pending-downloads'] || {};
    delete pending[downloadId];
    await browser.storage.local.set({ 'pending-downloads': pending });
}

async function removeMediaRequest(url) {
    if (!url) return;
    try {
        const baseUrl = url.split('?')[0];
        const res = await browser.storage.session.get(null);

        const activeUrls = new Set();
        for (const val of activeDownloads.values()) {
            if (val.url) activeUrls.add(val.url);
        }

        const keysToRemove = [];
        for (const key in res) {

            if (key.split('?')[0] === baseUrl && !activeUrls.has(key)) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            await browser.storage.session.remove(keysToRemove);
        }
    } catch (e) {
        console.error("Error in removeMediaRequest:", e);

        browser.storage.session.remove(url).catch(() => {});
    }
}

async function resumeInterruptedDownloads() {
    const settings = await browser.storage.local.get(['pending-downloads', 'auto-resume']);
    const pending = settings['pending-downloads'] || {};
    
    const autoResumeEnabled = settings['auto-resume'] !== '0' && settings['auto-resume'] !== false;
    const ids = Object.keys(pending);

    if (ids.length > 0) {
        for (const id of ids) {
            const data = pending[id];


            const shouldBePaused = !autoResumeEnabled || data.isPaused === true || data.isPaused === 'true';

            if (shouldBePaused) {
                activeDownloads.set(id, {
                    url: data.url,
                    filename: data.filename,
                    total: parseInt(data.total) || 0,
                    loaded: parseInt(data.loaded) || 0,
                    originalRequest: data.originalRequest,
                    isParallel: !!data.isParallel,
                    isPaused: true,
                    isManualResume: true,
                    mediaType: data.mediaType || getMediaType(data.url, [])
                });
            } else {
                setTimeout(() => {
                    handleFetchDownload(data.url, data.filename, data.originalRequest, id, true, true, data.loaded, data.mediaType, data.dropboxSessionId);
                }, 1000);
            }
        }
    }
}

resumeInterruptedDownloads();

const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";
const CHUNK_STORE_NAME = "download-chunks";

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onerror = (event) => reject(event.target.error || browser.i18n.getMessage("idbOpenError") || "IDB Open Error");
        request.onblocked = () => {
            console.warn("IndexedDB upgrade blocked by other tabs. Please close them.");
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "url" });
            }
            if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
                db.createObjectStore(CHUNK_STORE_NAME, { keyPath: ["downloadId", "chunkIndex"] });
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

async function storeInCache(url, blob, mime) {
    try {
        const db = await getDB();
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const item = {
            url: url,
            mime: mime || (blob && blob.type) || "application/octet-stream",
            data: blob,
            timestamp: Date.now()
        };
        return await new Promise((resolve, reject) => {
            const req = store.put(item);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("Failed to store in cache:", e);
    }
}

let cachedDB = null;
async function getDB() {
    if (cachedDB) return cachedDB;
    cachedDB = await openCacheDB();
    return cachedDB;
}

async function storeChunksInCache(downloadId, chunks) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([CHUNK_STORE_NAME], "readwrite");
            const store = tx.objectStore(CHUNK_STORE_NAME);

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(new Error("Transaction aborted"));

            for (const chunk of chunks) {
                const item = {
                    downloadId: downloadId,
                    chunkIndex: chunk.index,
                    data: chunk.data,
                    timestamp: Date.now()
                };
                store.put(item);
            }
        });
    } catch (e) {
        console.error("Failed to store chunks in cache:", e);
    }
}

async function storeChunkInCache(downloadId, chunkIndex, data) {
    return storeChunksInCache(downloadId, [{ index: chunkIndex, data: data }]);
}

const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"];
const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif"];
const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions, subtitleExtensions, imageExtensions);

const extPattern = allExtensions.map(e => e.replace(/^\./, '').replace(/\+/g, '\\+')).join('|');
const detectionRegex = new RegExp('\\.(?:' + extPattern + ')\\b', 'i');
const temporaryHeaderMap = new Map();
const temporaryRequestBodyMap = new Map();
const temporaryCookieMap = new Map();
const urlToHeaderMap = new Map();

const SPOOF_HEADERS = [
    'cookie', 'referer', 'origin', 'user-agent', 'accept', 'accept-language', 'accept-encoding',
    'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'x-requested-with',
    'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'
];

function sanitizeFilename(name) {
    if (!name) return name;
    return name.split('/').map(segment => {
        return segment.replace(/[\\:*?"<>|]/g, '_').trim();
    }).filter(segment => segment !== '' && segment !== '..').join('/');
}

function getUrlRuleId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) + 1;
}

function registerHeaderSpoofRules(url, headers) {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;
    const ruleId = getUrlRuleId(url);
    const requestHeaders = [];
    
    for (const [name, value] of Object.entries(headers)) {
        requestHeaders.push({
            header: name,
            operation: 'set',
            value: value
        });
    }

    const secFetchHeaders = ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'];
    secFetchHeaders.forEach(h => {
        if (!requestHeaders.some(rh => rh.header.toLowerCase() === h)) {
            requestHeaders.push({
                header: h,
                operation: 'remove'
            });
        }
    });

    const rule = {
        id: ruleId,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            requestHeaders: requestHeaders
        },
        condition: {
            urlFilter: url,
            resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']
        }
    };

    chrome.declarativeNetRequest.updateSessionRules({
        addRules: [rule],
        removeRuleIds: [ruleId]
    }).catch(err => console.warn("declarativeNetRequest add rule failed:", err));
}

function removeHeaderSpoofRules(url) {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;
    const ruleId = getUrlRuleId(url);
    chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId]
    }).catch(err => console.warn("declarativeNetRequest remove rule failed:", err));
}

async function loadPersistentHeaders() {
    try {
        const res = await browser.storage.session.get('urlToHeaderMap');
        if (res.urlToHeaderMap) {
            for (const [url, headers] of Object.entries(res.urlToHeaderMap)) {
                urlToHeaderMap.set(url, headers);
                registerHeaderSpoofRules(url, headers);
            }
        }
    } catch (e) {
        console.warn("Failed to load persistent headers:", e);
    }
}
loadPersistentHeaders();

function registerStaticYoutubeRules() {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;
    const rules = [
        {
            id: 99901,
            priority: 10,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [
                    { header: 'referer', operation: 'set', value: 'https://www.youtube.com/' },
                    { header: 'origin', operation: 'set', value: 'https://www.youtube.com' },
                    { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                ]
            },
            condition: {
                urlFilter: '||googlevideo.com',
                initiatorDomains: [chrome.runtime.id],
                resourceTypes: ['xmlhttprequest', 'media', 'other']
            }
        },
        {
            id: 99902,
            priority: 10,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [
                    { header: 'referer', operation: 'set', value: 'https://www.youtube.com/' },
                    { header: 'origin', operation: 'set', value: 'https://www.youtube.com' },
                    { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                ]
            },
            condition: {
                urlFilter: '||youtube.com',
                initiatorDomains: [chrome.runtime.id],
                resourceTypes: ['xmlhttprequest', 'media', 'other']
            }
        }
    ];
    chrome.declarativeNetRequest.updateSessionRules({
        addRules: rules,
        removeRuleIds: [99901, 99902]
    }).catch(err => console.warn("Static YouTube rules failed:", err));
}
registerStaticYoutubeRules();

let isOptimizeLowEnd = false;
browser.storage.local.get('optimize-low-end').then(res => {
    isOptimizeLowEnd = res['optimize-low-end'] === '1';
});
browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['optimize-low-end']) {
        isOptimizeLowEnd = changes['optimize-low-end'].newValue === '1';
    }
});

let savePersistentHeadersTimeout = null;
async function savePersistentHeaders() {
    const doSave = async () => {
        try {
            const obj = Object.fromEntries(urlToHeaderMap);

            const keys = Object.keys(obj);
            if (keys.length > 200) {
                const keysToRemove = keys.slice(0, keys.length - 200);
                keysToRemove.forEach(k => {
                    urlToHeaderMap.delete(k);
                    removeHeaderSpoofRules(k);
                });
                await browser.storage.session.set({ 'urlToHeaderMap': Object.fromEntries(urlToHeaderMap) });
            } else {
                await browser.storage.session.set({ 'urlToHeaderMap': obj });
            }
        } catch (e) {
            console.warn("Failed to save persistent headers:", e);
        }
    };

    if (isOptimizeLowEnd) {
        if (savePersistentHeadersTimeout) return;
        savePersistentHeadersTimeout = setTimeout(() => {
            savePersistentHeadersTimeout = null;
            doSave();
        }, 1000);
    } else {
        doSave();
    }
}

function isFlagEnabled(val, defaultVal = false) {
    if (val === undefined) return defaultVal;
    return val === '1' || val === 1 || val === true || val === 'true';
}

browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const capturedHeaders = {};
        let hasHeaders = false;

        for (const h of details.requestHeaders) {
            const name = h.name.toLowerCase();
            if (SPOOF_HEADERS.includes(name)) {
                capturedHeaders[name] = h.value;
                hasHeaders = true;
            }
        }

        if (capturedHeaders.referer && !capturedHeaders.origin) {
            try {
                const refUrl = new URL(capturedHeaders.referer);
                if (refUrl.protocol.startsWith('http')) {
                    capturedHeaders.origin = refUrl.origin;
                    hasHeaders = true;
                }
            } catch (e) {}
        }

        if (hasHeaders) {
            const current = urlToHeaderMap.get(details.url) || {};
            const mergedHeaders = { ...current, ...capturedHeaders };
            urlToHeaderMap.set(details.url, mergedHeaders);
            registerHeaderSpoofRules(details.url, mergedHeaders);
            savePersistentHeaders();
        }

        const isFromExtension = details.initiator?.startsWith('chrome-extension://') ||
                               details.originUrl?.startsWith('moz-extension://') ||
                               details.url.includes('blob:chrome-extension://');

        const isMediaRequest = details.type === 'media' ||
                               details.type === 'xmlhttprequest' ||
                               details.type === 'other' ||
                               details.url.includes('download') ||
                               detectionRegex.test(details.url);

        if (isMediaRequest || isFromExtension) {
            const stored = urlToHeaderMap.get(details.url);

            details.requestHeaders = details.requestHeaders.filter(h => {
                const val = h.value.toLowerCase();
                return !val.startsWith('chrome-extension://') && !val.startsWith('moz-extension://');
            });

            if (stored) {
                for (const [name, value] of Object.entries(stored)) {
                    let found = false;
                    for (let h of details.requestHeaders) {
                        if (h.name.toLowerCase() === name) {
                            h.value = value;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        details.requestHeaders.push({ name: name, value: value });
                    }

                    if (name === 'referer' && isFromExtension) {
                        details.referrer = value;
                    }
                }
            }

            if (isFromExtension) {
                const storedSFS = stored?.['sec-fetch-site'];
                const storedSFM = stored?.['sec-fetch-mode'];
                const storedSFD = stored?.['sec-fetch-dest'];

                details.requestHeaders = details.requestHeaders.filter(h =>
                    !['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(h.name.toLowerCase())
                );

                details.requestHeaders.push({
                    name: 'Sec-Fetch-Site',
                    value: storedSFS || (stored?.referer && details.url.includes(new URL(stored.referer).host) ? 'same-origin' : 'cross-site')
                });
                details.requestHeaders.push({ name: 'Sec-Fetch-Mode', value: storedSFM || 'no-cors' });
                details.requestHeaders.push({ name: 'Sec-Fetch-Dest', value: storedSFD || 'video' });
            }
        }

        const cookieHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'cookie');
        if (cookieHeader) temporaryCookieMap.set(details.requestId, cookieHeader.value);

        return;
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"]
);

let cachedSettings = {
    mediaNotification: true,
    mediaSystemNotification: true,
    stackNotifications: false,
    hideSegments: false,
    hidePageComponents: true,
    onlyVideo: true,
    onlyAudio: true,
    onlyStream: true,
    onlyImage: true,
    onlySubtitle: true,
    onlyFile: true,
    ignoreDisabledTypes: false,
    optimizeLowEnd: false,
    filenameTemplate: '',
    themeColor: '#8ab4f8'
};

function getSettings(callback) {
    browser.storage.local.get([
        'mime-detection', 'url-detection', 'media-notification', 'media-system-notification', 'stack-notifications', 'hide-segments', 'hide-page-components',
        'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file', 'ignore-disabled-types', 'optimize-low-end',
        'filename-template', 'theme-color', 'ui-scale'
    ], function (result) {
        const s = {
            mimeDetection: isFlagEnabled(result['mime-detection'], true),
            urlDetection: isFlagEnabled(result['url-detection'], true),
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
    tabMetadata.delete(tabId);
    tabsWithDrm.delete(tabId);
    notifiedUrls.delete(tabId);
    lastNotificationTime.delete(tabId);
});

async function updateActiveDownloadsBadge() {
    try {
        const settings = await browser.storage.local.get('badge-counter');
        const actionAPI = (typeof browser !== 'undefined' && browser.action) ? browser.action : (typeof chrome !== 'undefined' && chrome.action) ? chrome.action : (browser.browserAction || chrome.browserAction);
        if (!actionAPI || !actionAPI.setBadgeText) return;

        if (settings['badge-counter'] === '0') {
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

        const text = activeCount > 0 ? (activeCount > 99 ? '99+' : String(activeCount)) : '';
        actionAPI.setBadgeText({ text: text });
        if (activeCount > 0 && actionAPI.setBadgeBackgroundColor) {
            actionAPI.setBadgeBackgroundColor({ color: '#1976D2' });
        }
    } catch (e) {
        console.warn("Failed to update active downloads badge:", e);
    }
}

function isActivelyDownloading(item) {
    if (!item || item.paused || item.isPaused || item.cancelled) return false;
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
            status: val.status
        });
    }
    storageSession.set({ wmd_active_downloads: list }).catch(() => {});
}

function restoreActiveDownloadsFromSession() {
    const storageSession = (typeof browser !== 'undefined' && browser.storage && browser.storage.session) ? browser.storage.session : (typeof browser !== 'undefined' && browser.storage ? browser.storage.local : null);
    if (!storageSession) return;

    storageSession.get('wmd_active_downloads').then(res => {
        const list = res.wmd_active_downloads;
        if (list && Array.isArray(list)) {
            list.forEach(val => {
                if (!activeDownloads.has(val.id)) {
                    _origActiveDownloadsSet(val.id, val);
                }
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

function injectNotificationScript(tabId, filename, url, mediaType, title, themeColor, isDrm = false, hlsFormats = null, stackNotifications = false, uiScale = '85%') {
    if (!browser.scripting) return;

    const modalTranslations = {
        qualityModalTitle: browser.i18n.getMessage("qualityModalTitle") || "Pilih Kualitas Unduhan",
        qualityModalTabVideo: browser.i18n.getMessage("qualityModalTabVideo") || "Video + Audio",
        qualityModalTabAudio: browser.i18n.getMessage("qualityModalTabAudio") || "Audio Saja",
        qualityModalFormatLabel: browser.i18n.getMessage("qualityModalFormatLabel") || "Format / Tipe",
        qualityModalCodecLabel: browser.i18n.getMessage("qualityModalCodecLabel") || "Codec",
        qualityModalQualityLabel: browser.i18n.getMessage("qualityModalQualityLabel") || "Kualitas / Resolusi",
        qualityModalAudioExplain: browser.i18n.getMessage("qualityModalAudioExplain") || "Audio akan langsung diekstrak dan disimpan dalam format audio kualitas tinggi (.m4a/.webm).",
        qualityModalCancelBtn: browser.i18n.getMessage("qualityModalCancelBtn") || "Batal",
        qualityModalDownloadBtn: browser.i18n.getMessage("qualityModalDownloadBtn") || "Unduh"
    };

    browser.scripting.executeScript({
        target: { tabId: tabId },
        func: (name, downloadUrl, dlLabel, type, titleLabel, primaryColor, drm, formats, stack, t, uiScale) => {
             let safeColor = primaryColor || '#8ab4f8';
             if (typeof safeColor === 'string') {
                 safeColor = safeColor.trim();
                 if (!safeColor.startsWith('#') && !safeColor.startsWith('rgb')) {
                     safeColor = '#' + safeColor;
                 }
                 if (/^#[0-9a-fA-F]{3}$/.test(safeColor)) {
                     safeColor = '#' + safeColor[1] + safeColor[1] + safeColor[2] + safeColor[2] + safeColor[3] + safeColor[3];
                 }
             }
             function getContrastColor(hex) {
                 if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#121212';
                 const r = parseInt(hex.slice(1, 3), 16);
                 const g = parseInt(hex.slice(3, 5), 16);
                 const b = parseInt(hex.slice(5, 7), 16);
                 const yiq = (r * 299 + g * 587 + b * 114) / 1000;
                 return yiq >= 128 ? '#121212' : '#ffffff';
             }
             function hexToRgba(hex, alpha) {
                 if (!hex || !hex.startsWith('#') || hex.length !== 7) return `rgba(255, 255, 255, ${alpha})`;
                 const r = parseInt(hex.slice(1, 3), 16);
                 const g = parseInt(hex.slice(3, 5), 16);
                 const b = parseInt(hex.slice(5, 7), 16);
                 return `rgba(${r}, ${g}, ${b}, ${alpha})`;
             }
             const btnTextColor = getContrastColor(safeColor);
             const encodedColor = encodeURIComponent(safeColor);

             if (!stack) {
                 const existingToasts = document.querySelectorAll('.mdu-toast');
                 existingToasts.forEach(t => {
                     t.remove();
                 });
                 const existingModal = document.querySelector('.mdu-media-modal-backdrop');
                 if (existingModal) existingModal.remove();
             } else {
                 const existingToasts = document.querySelectorAll('.mdu-toast');
                 existingToasts.forEach(t => {
                     const currentBottom = parseInt(t.style.bottom || '24');
                     t.style.bottom = (currentBottom + 90) + 'px';
                 });
             }

             const toast = document.createElement('div');
             toast.className = 'mdu-toast';
            
            const icons = {
                video: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
                audio: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
                image: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
                stream: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM8 15c0-2.21 1.79-4 4-4s4 1.79 4 4l-4-2-4 2z"/></svg>',
                subtitle: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-1 12H5V8h14v8zM7 10h2v2H7v-2zm4 0h6v2h-6v-2z"/></svg>'
            };
            const icon = icons[type] || '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';

            toast.innerHTML = `
                <div class="mdu-toast-inner">
                    <div class="mdu-toast-icon">${icon}</div>
                    <div class="mdu-toast-content">
                        <div class="mdu-toast-title">${titleLabel}</div>
                        <div class="mdu-toast-filename">${name}</div>
                    </div>
                    <div class="mdu-toast-actions">
                        ${drm ? '' : `<button class="mdu-toast-dl-btn">${dlLabel}</button>`}
                    </div>
                </div>
                <div class="mdu-toast-progress-bar"></div>
            `;

            toast.style.cssText = `
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
                background: rgba(25, 25, 25, 0.45); color: white; border-radius: 9999px;
                z-index: 2147483647; width: ${drm ? '420px' : 'auto'}; min-width: 320px; max-width: 480px;
                box-shadow: 0 12px 40px rgba(0,0,0,0.4); font-family: 'Segoe UI', Roboto, sans-serif;
                overflow: hidden; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255,255,255,0.18);
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                animation: mdu-toast-in 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                touch-action: pan-y; user-select: none; -webkit-user-select: none;
                zoom: ${uiScale || '85%'};
            `;
            if (uiScale) toast.style.zoom = uiScale;

            const inner = toast.querySelector('.mdu-toast-inner');
            inner.style.cssText = `display: flex; align-items: center; padding: 14px 20px; gap: 14px;`;

            const iconCont = toast.querySelector('.mdu-toast-icon');
            iconCont.style.cssText = `color: ${safeColor}; flex-shrink: 0; display: flex; align-items: center;`;

            const content = toast.querySelector('.mdu-toast-content');
            content.style.cssText = `flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;

            const title = toast.querySelector('.mdu-toast-title');
            title.style.cssText = `font-size: 13px; color: ${safeColor}; font-weight: 600; opacity: 1;`;

            const filename = toast.querySelector('.mdu-toast-filename');
            filename.style.cssText = `font-size: 14px; ${drm ? 'white-space: normal;' : 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'} color: rgba(255,255,255,0.9);`;

            const actions = toast.querySelector('.mdu-toast-actions');
            actions.style.cssText = `display: flex; align-items: center; flex-shrink: 0;`;

            const showQualityModal = () => {
                const existingModal = document.querySelector('.mdu-media-modal-backdrop');
                if (existingModal) existingModal.remove();

                const modalBackdrop = document.createElement('div');
                modalBackdrop.className = 'mdu-media-modal-backdrop';
                modalBackdrop.style.cssText = `
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); z-index: 2147483647;
                    display: flex; align-items: center; justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    animation: mdu-fade-in 0.3s ease;
                `;

                modalBackdrop.innerHTML = `
                    <div class="mdu-media-modal" style="background: rgba(30, 30, 30, 0.85); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(25px); color: white; border-radius: 28px; width: 420px; padding: 24px; box-shadow: 0 24px 48px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 20px; animation: mdu-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); zoom: ${uiScale || '85%'};">
                        <div style="font-size: 18px; font-weight: 600; color: ${safeColor};">${t.qualityModalTitle}</div>
                        <div style="font-size: 14px; color: rgba(255,255,255,0.7); max-height: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
                        
                        <!-- Tab Video / Audio -->
                        <div style="display: flex; background: rgba(255,255,255,0.08); padding: 4px; border-radius: 12px; gap: 4px;">
                            <button id="tab-video" style="flex: 1; border: none; padding: 8px; border-radius: 8px; background: ${safeColor}; color: ${btnTextColor}; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;">${t.qualityModalTabVideo}</button>
                            <button id="tab-audio" style="flex: 1; border: none; padding: 8px; border-radius: 8px; background: transparent; color: white; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;">${t.qualityModalTabAudio}</button>
                        </div>

                        <!-- Video Options Container -->
                        <div id="video-options-container" style="display: flex; flex-direction: column; gap: 12px;">
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <label class="mdu-modal-label">${t.qualityModalFormatLabel}</label>
                                <select id="select-demuxer" class="mdu-modal-select"></select>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <label class="mdu-modal-label">${t.qualityModalCodecLabel}</label>
                                <select id="select-codec" class="mdu-modal-select"></select>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <label class="mdu-modal-label">${t.qualityModalQualityLabel}</label>
                                <select id="select-quality" class="mdu-modal-select"></select>
                            </div>
                        </div>

                        <!-- Audio Options Container -->
                        <div id="audio-options-container" style="display: none; flex-direction: column; gap: 12px;">
                            <div style="font-size: 13px; color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); line-height: 1.4;">
                                ${t.qualityModalAudioExplain}
                            </div>
                        </div>

                        <!-- Footer Buttons -->
                        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px;">
                            <button id="btn-cancel" style="background: transparent; color: white; border: 1px solid rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 14px; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;">${t.qualityModalCancelBtn}</button>
                            <button id="btn-download" style="background: ${safeColor}; color: ${btnTextColor}; border: none; padding: 10px 24px; border-radius: 14px; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;">${t.qualityModalDownloadBtn}</button>
                        </div>
                    </div>
                    
                    <style>
                        @keyframes mdu-fade-in { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes mdu-scale-in { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }

                        .mdu-modal-label {
                            font-size: 12px !important;
                            color: rgba(255,255,255,0.5) !important;
                            font-weight: 600 !important;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                            margin: 0 !important;
                            padding: 0 !important;
                            line-height: 1.4 !important;
                        }

                        .mdu-modal-select {
                            appearance: none !important;
                            -webkit-appearance: none !important;
                            -moz-appearance: none !important;
                            background-color: ${hexToRgba(safeColor, 0.15)} !important;
                            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${encodedColor}"><path d="M7 10l5 5 5-5z"/></svg>') !important;
                            background-repeat: no-repeat !important;
                            background-position: right 12px center !important;
                            background-size: 20px !important;
                            color: white !important;
                            border: 1.5px solid ${hexToRgba(safeColor, 0.35)} !important;
                            padding: 11px 38px 11px 14px !important;
                            border-radius: 12px !important;
                            font-size: 13px !important;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                            font-weight: 500 !important;
                            width: 100% !important;
                            outline: none !important;
                            cursor: pointer !important;
                            transition: all 0.2s ease !important;
                            box-sizing: border-box !important;
                            box-shadow: 0 2px 6px rgba(0,0,0,0.15) !important;
                            line-height: 1.4 !important;
                            margin: 0 !important;
                            min-height: 42px !important;
                        }

                        .mdu-modal-select:hover {
                            border-color: rgba(255,255,255,0.3) !important;
                            background-color: rgba(255,255,255,0.12) !important;
                            box-shadow: 0 3px 10px rgba(0,0,0,0.2) !important;
                        }

                        .mdu-modal-select:focus {
                            border-color: ${safeColor} !important;
                            box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2), 0 3px 10px rgba(0,0,0,0.2) !important;
                        }

                        .mdu-modal-select option {
                            background: #2a2a2a !important;
                            color: white !important;
                            padding: 10px 14px !important;
                            font-size: 13px !important;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                        }

                        .mdu-modal-select option:hover,
                        .mdu-modal-select option:checked {
                            background: ${safeColor} !important;
                            color: ${btnTextColor} !important;
                        }
                    </style>
                `;

                document.body.appendChild(modalBackdrop);

                let activeMode = "video";
                const tabVideo = modalBackdrop.querySelector('#tab-video');
                const tabAudio = modalBackdrop.querySelector('#tab-audio');
                const videoOptions = modalBackdrop.querySelector('#video-options-container');
                const audioOptions = modalBackdrop.querySelector('#audio-options-container');

                tabVideo.onclick = () => {
                    activeMode = "video";
                    tabVideo.style.background = primaryColor;
                    tabVideo.style.color = '#121212';
                    tabAudio.style.background = 'transparent';
                    tabAudio.style.color = 'white';
                    videoOptions.style.display = 'flex';
                    audioOptions.style.display = 'none';
                };

                tabAudio.onclick = () => {
                    activeMode = "audio";
                    tabAudio.style.background = primaryColor;
                    tabAudio.style.color = '#121212';
                    tabVideo.style.background = 'transparent';
                    tabVideo.style.color = 'white';
                    audioOptions.style.display = 'flex';
                    videoOptions.style.display = 'none';
                };

                const getHumanReadableSize = (size) => {
                    const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
                    let sizeInBytes = parseInt(size);
                    if (isNaN(sizeInBytes)) return "Unknown Size";
                    let i = 0;
                    while (sizeInBytes > 1024 && i < units.length - 1) { sizeInBytes /= 1024; i++; }
                    return `${sizeInBytes.toFixed(2)} ${units[i]}`;
                };

                const selectDemuxer = modalBackdrop.querySelector('#select-demuxer');
                const selectCodec = modalBackdrop.querySelector('#select-codec');
                const selectQuality = modalBackdrop.querySelector('#select-quality');

                const isHlsStream = formats && formats.length > 0 && formats[0].demuxer === 'm3u8';

                if (isHlsStream) {
                    // Hide tabs and other selectors
                    modalBackdrop.querySelector('#tab-video').parentNode.style.display = 'none';
                    selectDemuxer.parentNode.style.display = 'none';
                    selectCodec.parentNode.style.display = 'none';

                    // Populate HLS resolutions directly
                    formats.forEach((fmt, idx) => {
                        const opt = document.createElement('option');
                        opt.value = idx;
                        let optLabel = fmt.resolution || 'unknown';
                        if (fmt.bandwidth) {
                            optLabel += ` (${Math.round(fmt.bandwidth / 1000)} kbps)`;
                        }
                        opt.textContent = optLabel;
                        selectQuality.appendChild(opt);
                    });
                } else {
                    const demuxers = [...new Set(formats.map(fmt => fmt.demuxer))];
                    demuxers.forEach(d => {
                        const opt = document.createElement('option');
                        opt.value = d;
                        opt.textContent = d.toUpperCase();
                        selectDemuxer.appendChild(opt);
                    });

                    function updateCodecDropdown() {
                        selectCodec.innerHTML = '';
                        const selectedDemuxer = selectDemuxer.value;
                        const availableCodecs = [...new Set(formats.filter(fmt => fmt.demuxer === selectedDemuxer).map(fmt => fmt.codec || 'UNKNOWN'))];
                        
                        availableCodecs.forEach(c => {
                            const opt = document.createElement('option');
                            opt.value = c;
                            opt.textContent = c;
                            selectCodec.appendChild(opt);
                        });

                        if (availableCodecs.includes('AV1')) selectCodec.value = 'AV1';
                        else if (availableCodecs.includes('VP9')) selectCodec.value = 'VP9';
                        else if (availableCodecs.includes('H265')) selectCodec.value = 'H265';
                        else if (availableCodecs.includes('H264')) selectCodec.value = 'H264';
                        else selectCodec.value = availableCodecs[0];

                        updateResolutionDropdown();
                    }

                    function updateResolutionDropdown() {
                        selectQuality.innerHTML = '';
                        const selectedDemuxer = selectDemuxer.value;
                        const selectedCodec = selectCodec.value;

                        const availableFormats = formats.filter(fmt => 
                            fmt.demuxer === selectedDemuxer && 
                            (fmt.codec === selectedCodec || (!fmt.codec && selectedCodec === 'UNKNOWN'))
                        );
                        
                        availableFormats.forEach((fmt) => {
                            const opt = document.createElement('option');
                            opt.value = formats.indexOf(fmt);
                            let optLabel = fmt.label || `${fmt.width}x${fmt.height}`;
                            if (fmt.contentLength) {
                                optLabel += ` • ${getHumanReadableSize(fmt.contentLength)}`;
                            }
                            opt.textContent = optLabel;
                            selectQuality.appendChild(opt);
                        });
                    }

                    selectDemuxer.onchange = updateCodecDropdown;
                    selectCodec.onchange = updateResolutionDropdown;

                    if (demuxers.includes('mp4')) {
                        selectDemuxer.value = 'mp4';
                    } else if (demuxers.length > 0) {
                        selectDemuxer.value = demuxers[0];
                    }
                    updateCodecDropdown();
                }

                const btnCancel = modalBackdrop.querySelector('#btn-cancel');
                const btnDownload = modalBackdrop.querySelector('#btn-download');

                btnCancel.onclick = () => modalBackdrop.remove();

                btnDownload.onclick = () => {
                    const selectedIdx = parseInt(selectQuality.value);
                    const fmt = formats[selectedIdx];
                    if (fmt) {
                        if (fmt.demuxer === 'm3u8') {
                            chrome.runtime.sendMessage({
                                action: 'downloadHlsStream',
                                url: fmt.videoUrl,
                                quality: fmt.resolution && fmt.bandwidth ? `${fmt.resolution}@${fmt.bandwidth}` : (fmt.resolution || fmt.bandwidth?.toString() || 'highest'),
                                filename: name
                            });
                        }
                    }
                    modalBackdrop.remove();
                };
            };

            if (!drm) {
                const dlBtn = toast.querySelector('.mdu-toast-dl-btn');
                dlBtn.style.cssText = `
                    background: ${safeColor}; color: ${btnTextColor}; border: none; padding: 8px 18px;
                    border-radius: 18px; cursor: pointer; font-weight: 600; font-size: 13px;
                    transition: all 0.2s ease;
                `;
                dlBtn.onmouseenter = () => { dlBtn.style.filter = 'brightness(1.15)'; dlBtn.style.transform = 'translateY(-1px)'; };
                dlBtn.onmouseleave = () => { dlBtn.style.filter = 'brightness(1)'; dlBtn.style.transform = 'translateY(0)'; };
                dlBtn.onmousedown = () => dlBtn.style.transform = 'scale(0.95)';
                dlBtn.onmouseup = () => dlBtn.style.transform = 'scale(1)';
                dlBtn.onclick = () => {
                    if (formats && formats.length > 0) {
                        showQualityModal();
                    } else {
                        chrome.runtime.sendMessage({ action: 'startDownloadFromToast', url: downloadUrl });
                    }
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateX(-50%) translateY(10px) scale(0.95)';
                    setTimeout(() => toast.remove(), 300);
                };
            }

            const progressBar = toast.querySelector('.mdu-toast-progress-bar');
            progressBar.style.cssText = `
                position: absolute; bottom: 0; left: 0; height: 3px;
                background: ${safeColor}; width: 100%; transition: width 6s linear;
                opacity: 0.5;
            `;

            const style = document.createElement('style');
            style.id = 'mdu-toast-style';
            style.textContent = `
                @keyframes mdu-toast-in {
                    from { bottom: -80px; opacity: 0; transform: translateX(-50%) scale(0.9); }
                    to { bottom: 24px; opacity: 1; transform: translateX(-50%) scale(1); }
                }
            `;
            if (!document.getElementById('mdu-toast-style')) document.head.appendChild(style);

            // Swipe / Drag dismiss logic
            let isDragging = false;
            let startX = 0;
            let diffX = 0;

            const handleStart = (clientX) => {
                isDragging = true;
                startX = clientX;
                toast.style.transition = 'none';
            };

            const handleMove = (clientX) => {
                if (!isDragging) return;
                diffX = clientX - startX;
                const dragOpacity = Math.max(0, 1 - Math.abs(diffX) / 150);
                toast.style.transform = `translateX(calc(-50% + ${diffX}px))`;
                toast.style.opacity = dragOpacity;
            };

            const handleEnd = () => {
                if (!isDragging) return;
                isDragging = false;
                toast.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                if (Math.abs(diffX) > 80) {
                    const slideDir = diffX > 0 ? 200 : -200;
                    toast.style.transform = `translateX(calc(-50% + ${slideDir}px))`;
                    toast.style.opacity = '0';
                    setTimeout(() => {
                        if (toast.parentNode) toast.remove();
                    }, 300);
                } else {
                    toast.style.transform = 'translateX(-50%)';
                    toast.style.opacity = '1';
                }
                diffX = 0;
            };

            toast.addEventListener('touchstart', (e) => {
                handleStart(e.touches[0].clientX);
            }, { passive: true });

            toast.addEventListener('touchmove', (e) => {
                handleMove(e.touches[0].clientX);
            }, { passive: true });

            toast.addEventListener('touchend', handleEnd, { passive: true });

            toast.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.closest('button') || e.target.closest('select')) {
                    return;
                }
                handleStart(e.clientX);
                
                const onMouseMove = (moveEvt) => {
                    handleMove(moveEvt.clientX);
                };
                
                const onMouseUp = () => {
                    handleEnd();
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
                
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            document.body.appendChild(toast);

            setTimeout(() => { progressBar.style.width = '0%'; }, 10);
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateX(-50%) translateY(10px) scale(0.95)';
                    setTimeout(() => toast.remove(), 300);
                }
            }, 6000);
        },
        args: [filename, url, browser.i18n.getMessage("mediaNotificationDownloadAction") || "Download", mediaType, title, themeColor, isDrm, hlsFormats, stackNotifications, modalTranslations, uiScale]
    }).catch(() => {});
}

function getMediaType(url, contentType) {
    if (!url) return null;
    const urlLower = url.toLowerCase();
    let mimeLower = '';
    
    if (Array.isArray(contentType)) {
        mimeLower = (contentType[0] || '').toLowerCase();
    } else {
        mimeLower = (contentType || '').toLowerCase();
    }

    if (urlLower.startsWith('chrome-extension://') ||
        urlLower.startsWith('moz-extension://') ||
        urlLower.startsWith('blob:chrome-extension://') ||
        urlLower.startsWith('blob:moz-extension://')) {
        return null;
    }

    if (mimeLower.startsWith('video/') || urlLower.includes('mime=video') || urlLower.includes('#video')) return 'video';
    if (mimeLower.startsWith('audio/') || urlLower.includes('mime=audio') || urlLower.includes('#audio')) return 'audio';

    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"];
    const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif"];
    const downloadExtensions = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

    const urlPath = urlLower.split('?')[0].split('#')[0];
    const hasExt = (ext) => urlPath.endsWith(ext) || urlLower.includes(ext + '&') || urlLower.includes(ext + '?') || urlLower.includes(ext + '#') || urlLower.endsWith(ext);

    if (videoExtensions.some(hasExt)) return 'video';
    if (audioExtensions.some(hasExt)) return 'audio';

    if (mimeLower === 'image/svg+xml' || hasExt('.svg')) return null;
    if (mimeLower.startsWith('image/') || imageExtensions.some(hasExt) || urlLower.includes('#image')) return 'image';

    if (streamExtensions.some(hasExt) || mimeLower.includes('mpegurl') || mimeLower.includes('dash+xml') || urlLower.includes('#stream')) return 'stream';
    if (subtitleExtensions.some(hasExt) || mimeLower.includes('vtt') || mimeLower.includes('subrip') || mimeLower.includes('ass') || mimeLower.includes('ttml') || mimeLower.includes('dfxp') || mimeLower.includes('sami') || mimeLower.includes('smil') || mimeLower.includes('lrc') || mimeLower.includes('sbv') || mimeLower.includes('microdvd') || urlLower.includes('#subtitle')) return 'subtitle';

    if (downloadExtensions.some(hasExt) || urlLower.includes('#file')) return 'file';

    return null;
}

function checkIsSegment(url, contentType, contentLength, currentSettings) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    const mimeLower = (contentType || '').toLowerCase();
    const size = parseInt(contentLength) || 0;

    const isHideSegments = currentSettings?.hideSegments ?? true;
    const isHidePageComponents = currentSettings?.hidePageComponents ?? true;




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

        if (currentSettings && currentSettings.onlyImage && (path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.webp') || path.endsWith('.png'))) {
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

    if (mimeLower === 'video/mp2t' || 
        mimeLower === 'video/iso.segment' || 
        mimeLower === 'audio/iso.segment') {
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

async function addToHistory(item) {
    const result = await browser.storage.local.get('history-page');
    if (result['history-page'] !== '1') return;

    if (!item.mediaType) {
        item.mediaType = getMediaType(item.url, '');
    }

    const historyResult = await browser.storage.local.get('download-history');
    let history = historyResult['download-history'] || [];

    item.timestamp = item.timestamp || Date.now();

    const existingIndex = history.findIndex(h =>
        h.url === item.url ||
        (h.pageUrl === item.pageUrl && h.filename === item.filename)
    );

    if (existingIndex !== -1) {
        history.splice(existingIndex, 1);
    }

    history.unshift(item);
    if (history.length > 100) history = history.slice(0, 100);
    await browser.storage.local.set({ 'download-history': history });
}

function showSimpleToast(tabId, message) {
    if (!browser.scripting) return;
    browser.scripting.executeScript({
        target: { tabId: tabId },
        func: (msg) => {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
                background: #4caf50; color: white; padding: 12px 24px; border-radius: 8px;
                z-index: 2147483647; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-family: system-ui, sans-serif; font-size: 14px; font-weight: 500;
                animation: mdu-slide-down 0.4s cubic-bezier(0, 0, 0.2, 1);
            `;
            toast.textContent = msg;

            const style = document.createElement('style');
            style.textContent = `@keyframes mdu-slide-down { from { top: -60px; opacity: 0; } to { top: 24px; opacity: 1; } }`;
            document.head.appendChild(style);
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; setTimeout(() => toast.remove(), 500); }, 3000);
        },
        args: [message]
    }).catch(() => {});
}

async function autoUpdateHistoryLink(pageUrl, filename, newUrl, tabId) {
    const historyResult = await browser.storage.local.get('download-history');
    let history = historyResult['download-history'] || [];
    let updated = false;

    for (let i = 0; i < history.length; i++) {

        if (history[i].pageUrl === pageUrl && history[i].filename === filename) {
            if (history[i].url !== newUrl) {
                history[i].url = newUrl;
                history[i].timestamp = Date.now();

                const item = history.splice(i, 1)[0];
                history.unshift(item);
                updated = true;
            }
            break;
        }
    }

    if (updated) {
        await browser.storage.local.set({ 'download-history': history });
        if (tabId) {
            showSimpleToast(tabId, browser.i18n.getMessage("historyLinkUpdated") || "Link updated successfully.");
        }
    }
}

async function getAutomaticFilename(url, tabId, metadata = {}) {
    let pageTitle = metadata.pageTitle || tabMetadata.get(tabId)?.title || '';
    if (!pageTitle && tabId >= 0) {
        try { pageTitle = (await browser.tabs.get(tabId)).title || ''; } catch (_) {}
    }
    return mediaFilename.resolve(url, { ...metadata, pageTitle });
}

async function generateTemplateName(template, url, originalName, tabId) {
    let pageTitle = tabMetadata.get(tabId)?.title || '';
    if (!pageTitle && tabId >= 0) {
        try { pageTitle = (await browser.tabs.get(tabId)).title || ''; } catch (_) {}
    }
    return mediaFilename.template(template, url, originalName, pageTitle);
}

async function showMediaNotification(details, settings) {
    if (await detectionExclusions.shouldSkip(details, true)) return;
    if (!settings.mediaNotification) return;

    const url = details.url;
    const tabId = details.tabId;
    if (tabId < 0) return;



    const sessionData = await new Promise(resolve => {
        browser.storage.session.get(url, (res) => resolve(res[url] || []));
    });
    const requestItem = sessionData.length > 0 ? sessionData[sessionData.length - 1] : null;
    let hlsFormats = null;

    if (!hlsFormats && url.toLowerCase().includes('.m3u8')) {
        try {
            const hlsVariants = await getM3U8VariantsBg(url);
            if (hlsVariants && hlsVariants.length > 0) {
                hlsFormats = hlsVariants.map(v => ({
                    resolution: v.resolution,
                    bandwidth: v.bandwidth,
                    videoUrl: url,
                    variantUrl: v.uri,
                    demuxer: 'm3u8'
                }));
            }
        } catch (e) {
            console.warn("Failed to get HLS variants for notification:", e);
        }
    }

    const baseUrl = url.split('?')[0].split('#')[0];

    if (!notifiedUrls.has(tabId)) notifiedUrls.set(tabId, new Set());
    const tabNotified = notifiedUrls.get(tabId);
    if (tabNotified.has(baseUrl)) return;

    const responseHeaders = details.responseHeaders || [];
    let contentType = responseHeaders.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
    let contentLength = parseInt(responseHeaders.find(h => h.name.toLowerCase() === 'content-length')?.value || '0');

    const mediaType = getMediaType(url, contentType);
    const isVideo = mediaType === 'video';
    const isAudio = mediaType === 'audio';
    const isImage = mediaType === 'image';
    const isStream = mediaType === 'stream';
    const isSubtitle = mediaType === 'subtitle';

    if (isVideo && !settings.onlyVideo) return;
    if (isAudio && !settings.onlyAudio) return;
    if (isStream && !settings.onlyStream) return;
    if (isImage && !settings.onlyImage) return;
    if (isSubtitle && !settings.onlySubtitle) return;
    if (isMediaTypeDisabled(mediaType, settings)) return;

    if (!mediaType) return;

    if (!details.isYtNotification && checkIsSegment(url, contentType, contentLength, settings)) return;

    const now = Date.now();

    if (lastNotificationTime.has(tabId) && (now - lastNotificationTime.get(tabId) < 2000)) {
        return;
    }

    let displayFilename = getFileName(url, 180);
    try {
        displayFilename = await getAutomaticFilename(url, tabId, {
            ...(requestItem || {}),
            ...details,
            pageTitle: requestItem?.pageTitle || details.pageTitle,
            responseHeaders: details.responseHeaders || requestItem?.responseHeaders
        });
    } catch (error) {
        console.warn('Notification filename fallback:', error);
    }
    if (settings.filenameTemplate && settings.filenameTemplate !== '0') {
        try {
            displayFilename = await generateTemplateName(settings.filenameTemplate, url, displayFilename, tabId);
        } catch (error) {
            console.warn('Notification filename template fallback:', error);
        }
    }

    const notificationTime = Date.now();
    if (tabNotified.has(baseUrl) ||
        (lastNotificationTime.has(tabId) && notificationTime - lastNotificationTime.get(tabId) < 2000)) return;
    tabNotified.add(baseUrl);
    lastNotificationTime.set(tabId, notificationTime);

    let pageUrl = "";
    try {
        const tab = await browser.tabs.get(tabId);
        if (tab) pageUrl = tab.url;
    } catch (e) {}

    if (pageUrl) {
        autoUpdateHistoryLink(pageUrl, displayFilename, url, tabId);
    }

    const isDrm = tabsWithDrm.has(tabId);
    const drmMsg = browser.i18n.getMessage("mediaNotificationDrmMessage") || "DRM Protected";

    const finalDisplayFilename = isDrm ? drmMsg : displayFilename;
    const notificationTitle = isDrm ? (browser.i18n.getMessage("drmWarningTitle") || "DRM Detected") : (browser.i18n.getMessage("mediaNotificationTitle") || "Media detected!");

    injectNotificationScript(tabId, finalDisplayFilename, url, mediaType, notificationTitle, settings.themeColor, isDrm, hlsFormats, settings.stackNotifications, settings.uiScale || cachedSettings.uiScale || '85%');

    const notificationButtons = isDrm ? [] : [
        { title: browser.i18n.getMessage("mediaNotificationDownloadAction") || "Download" }
    ];

    if (settings.mediaSystemNotification) {
        browser.notifications.create({
            type: "basic",
            iconUrl: browser.runtime.getURL("icons/icon.png"),
            title: notificationTitle,
            message: finalDisplayFilename,
            buttons: notificationButtons
        }, (notificationId) => {
            if (browser.runtime.lastError) {
                console.warn("Notification error (normal in some mobile browsers):", browser.runtime.lastError.message);
            }
            notificationUrls.set(notificationId, { url, tabId });
        });
    }
}

browser.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const data = notificationUrls.get(notificationId);
    if (data && buttonIndex === 0) {
        browser.storage.session.get(data.url, async (result) => {
            const requests = result[data.url];
            if (requests && requests.length > 0) {
                const request = requests[requests.length - 1];
                let pageUrl = "";
                let pageTitle = "";
                try {
                    const tab = await browser.tabs.get(data.tabId);
                    if (tab) {
                        pageUrl = tab.url;
                        pageTitle = tab.title;
                    }
                } catch (e) {}

                browser.storage.local.get(['download-method', 'filename-template', 'gdrive-stream', 'save-to-gdrive', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token'], async (res) => {
                    let method = res['download-method'] || 'browser';
                    const isGdriveStream = res['save-to-gdrive'] === '1' && res['gdrive-stream'] === '1' && res['gdrive_token'];
                    if (isGdriveStream) method = 'fetch';

                    const template = res['filename-template'];
                    const originalName = await getAutomaticFilename(data.url, data.tabId, request || {});
                    let finalName = originalName;

                    if (template) {
                        finalName = await generateTemplateName(template, data.url, originalName, data.tabId);
                    }

                    addToHistory({ url: data.url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });

                    if (method === 'fetch') {
                        handleFetchDownload(data.url, finalName, request);
                    } else {
                        browser.downloads.download({
                            url: data.url,
                            filename: sanitizeFilename(finalName),
                            saveAs: false
                        });
                    }
                });
            }
        });
    }
    notificationUrls.delete(notificationId);
});

browser.notifications.onClicked.addListener((notificationId) => {
    const data = notificationUrls.get(notificationId);
    let popupUrl = `popup.html?mode=tab`;
    if (data && data.url) {
        popupUrl += `&autoOpenUrl=${encodeURIComponent(data.url)}`;
    }
    browser.tabs.create({
        url: browser.runtime.getURL(popupUrl),
    });
    notificationUrls.delete(notificationId);
});

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

let beforeRequestListener, beforeSendHeadersListener;

function initListener() {

    openCacheDB().then(db => {
        const tx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(CHUNK_STORE_NAME).clear();
    }).catch(e => {
        console.error("Failed to clear IndexedDB cache on init:", e);
    });

    urlList = ["<all_urls>"];

    getSettings(function (settings) {
        const mimeEnabled = !!settings.mimeDetection;
        const urlEnabled = !!settings.urlDetection;

        if (headersSentListener) {
            try { browser.webRequest.onSendHeaders.removeListener(headersSentListener); } catch (e) { }
        }
        if (beforeSendHeadersListener) {
            try { browser.webRequest.onBeforeSendHeaders.removeListener(beforeSendHeadersListener); } catch (e) { }
        }
        if (headersReceivedListener) {
            try { browser.webRequest.onHeadersReceived.removeListener(headersReceivedListener); } catch (e) { }
        }
        if (beforeRequestListener) {
            try { browser.webRequest.onBeforeRequest.removeListener(beforeRequestListener); } catch (e) { }
            beforeRequestListener = null;
        }

        const cleanupListener = (details) => {
            if (temporaryHeaderMap.has(details.requestId)) {
                temporaryHeaderMap.delete(details.requestId);
            }
            if (temporaryRequestBodyMap.has(details.requestId)) {
                temporaryRequestBodyMap.delete(details.requestId);
            }
            if (temporaryCookieMap.has(details.requestId)) {
                temporaryCookieMap.delete(details.requestId);
            }
        };

        if (!browser.webRequest.onCompleted.hasListener(cleanupListener)) {
            browser.webRequest.onCompleted.addListener(cleanupListener, { urls: ["<all_urls>"] });
            browser.webRequest.onErrorOccurred.addListener(cleanupListener, { urls: ["<all_urls>"] });
        }

        beforeRequestListener = function (details) {
            try {
                if (!details || !details.requestBody) return;
                const mType = getMediaType(details.url);
                if (isMediaTypeDisabled(mType, cachedSettings)) return;

                const rb = details.requestBody;

                if (rb.formData) {

                    temporaryRequestBodyMap.set(details.requestId, { type: 'formData', data: rb.formData });
                } else if (rb.raw && rb.raw.length) {

                    try {

                        let totalLen = 0;
                        for (let part of rb.raw) {
                            if (part && part.bytes) {
                                totalLen += part.bytes.byteLength || part.bytes.length || 0;
                            }
                        }
                        if (totalLen === 0) {
                            return;
                        }

                        if (totalLen > 1024 * 1024) {
                            console.debug("Request body too large to capture:", totalLen);
                            temporaryRequestBodyMap.set(details.requestId, { type: 'error', data: 'Body too large to capture' });
                            return;
                        }

                        const combined = new Uint8Array(totalLen);
                        let offset = 0;
                        for (let part of rb.raw) {
                            if (!part || !part.bytes) continue;
                            const src = new Uint8Array(part.bytes);
                            combined.set(src, offset);
                            offset += src.length;
                        }
                        const base64 = arrayBufferToBase64(combined.buffer);
                        temporaryRequestBodyMap.set(details.requestId, { type: 'base64', data: base64 });
                    } catch (e) {
                        console.warn("Failed to serialize raw request body for requestId", details.requestId, e);
                    }
                }
            } catch (e) {
                console.error("Error in onBeforeRequest listener (requestBody capture):", e);
            }
        };

        try {
            if (browser.webRequest && browser.webRequest.onBeforeRequest && !browser.webRequest.onBeforeRequest.hasListener(beforeRequestListener)) {
                browser.webRequest.onBeforeRequest.addListener(
                    beforeRequestListener,
                    { urls: urlList },
                    ['requestBody']
                );
            }
        } catch (e) {
            console.warn("Failed to attach onBeforeRequest requestBody listener:", e);
        }

        beforeSendHeadersListener = async function (details) {
            const cookie = details.requestHeaders?.find(h => h.name.toLowerCase() === 'cookie')?.value || '';
            temporaryCookieMap.set(details.requestId, cookie);

            return;
        };

        browser.webRequest.onBeforeSendHeaders.addListener(
            beforeSendHeadersListener,
            { urls: urlList },
            ['requestHeaders', 'extraHeaders']
        );

        headersSentListener = async function (details) {
            if (await detectionExclusions.shouldSkip(details)) return;
            try {
                const mType = getMediaType(details.url);
                if (isMediaTypeDisabled(mType, cachedSettings)) return;

                if (details.requestHeaders) {
                    temporaryHeaderMap.set(details.requestId, details.requestHeaders);
                }


                const urlMatches = detectionRegex.test(decodeURI(details.url));

                if (!mimeEnabled && !urlEnabled) {
                    return;
                } else {

                    if (!urlEnabled || (urlEnabled && !urlMatches)) {

                        if (urlEnabled && mimeEnabled && !urlMatches) {

                            return;
                        }
                        if (mimeEnabled && !urlEnabled) {
                            return;
                        }

                    }
                }

                const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;
                const metadata = details.tabId >= 0 ? tabMetadata.get(details.tabId) : null;

                let mediaRequest = {
                    url: details.url,
                    method: details.method,
                    requestHeaders: details.requestHeaders,
                    responseHeaders: null,
                    requestBody: cachedBody,
                    cookie: temporaryCookieMap.get(details.requestId) || '',
                    size: null,
                    timeStamp: null,
                    tabId: details.tabId,
                    pageTitle: metadata ? metadata.title : "",
                    pageUrl: metadata ? metadata.url : ""
                };

                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = result[details.url] || [];

                    existingRequests.push(mediaRequest);
                    let requestsObj = {};
                    requestsObj[details.url] = existingRequests;
                    browser.storage.session.set(requestsObj);
                });
            } catch (e) {
                console.error("Error in onSendHeaders handler:", e);
            }
        };

        browser.webRequest.onSendHeaders.addListener(
            headersSentListener,
            { urls: urlList },
            ['requestHeaders']
        );

        headersReceivedListener = async function (details) {
            if (await detectionExclusions.shouldSkip(details)) return;
            try {

                const responseHeaders = details.responseHeaders || [];
                let size = 'unknown';

                let mediaSizeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-length');
                if (mediaSizeHeader) size = mediaSizeHeader.value;

                let contentRangeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-range');
                if (contentRangeHeader && contentRangeHeader.value.includes('/')) {
                    const totalSize = contentRangeHeader.value.split('/').pop();
                    if (totalSize && totalSize !== '*') {
                        size = totalSize;
                    }
                }

                let contentTypeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-type');
                let contentType = contentTypeHeader ? (contentTypeHeader.value || '').toLowerCase() : '';

                if (contentType.indexOf(';') !== -1) {
                    contentType = contentType.split(';')[0].trim().toLowerCase();
                }

                const mimeMatches = (
                    contentType.startsWith('audio/') ||
                    contentType.startsWith('video/') ||
                    contentType.startsWith('image/') ||
                    contentType.includes('mpegurl') ||
                    contentType.includes('dash+xml') ||
                    contentType.includes('vtt') ||
                    contentType.includes('subrip') ||
                    contentType.includes('ass') ||
                    contentType.includes('ttml') ||
                    contentType.includes('dfxp') ||
                    contentType === 'application/octet-stream'
                );

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = result[details.url] || [];

                    let updated = false;
                    for (let request of existingRequests) {

                        if (!request.size && (!request.responseHeaders || request.responseHeaders === null)) {
                            request.size = size;
                            request.responseHeaders = responseHeaders;
                            request.timeStamp = details.timeStamp;
                            updated = true;
                            break;
                        }
                    }

                    getSettings(async function (currentSettings) {
                        const mimeEnabledNow = !!currentSettings.mimeDetection;
                        const urlEnabledNow = !!currentSettings.urlDetection;
                        const mType = getMediaType(details.url, contentType);

                        const shouldSaveNow = (() => {
                            if (isMediaTypeDisabled(mType, currentSettings)) return false;
                            if (checkIsSegment(details.url, contentType, size, currentSettings)) return false;
                            if (!mimeEnabledNow && !urlEnabledNow) return false;
                            if (mimeEnabledNow && mimeMatches) return true;
                            if (urlEnabledNow && urlMatches) return true;
                            return false;
                        })();

                        const isDrm = tabsWithDrm.has(details.tabId);
                        const isDrmMedia = isDrm && (mType === 'video' || mType === 'audio' || mType === 'stream');

                        if (shouldSaveNow) {
                            const cachedHeaders = temporaryHeaderMap.get(details.requestId) || null;
                            const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;
                            
                            let pageTitle = "";
                            let pageUrl = "";
                            try {
                                if (details.tabId >= 0) {
                                    let metadata = tabMetadata.get(details.tabId);
                                    if (metadata && metadata.title) {
                                        pageTitle = metadata.title;
                                        pageUrl = metadata.url;
                                    } else {
                                        const tab = await browser.tabs.get(details.tabId);
                                        if (tab) {
                                            pageTitle = tab.title || "";
                                            pageUrl = tab.url || "";
                                            tabMetadata.set(details.tabId, { title: pageTitle, url: pageUrl });
                                        }
                                    }
                                }
                            } catch (e) {}

                            let mediaRequest = {
                                url: details.url,
                                method: details.method || 'GET',
                                requestHeaders: cachedHeaders,
                                responseHeaders: responseHeaders,
                                requestBody: cachedBody,
                                cookie: temporaryCookieMap.get(details.requestId) || '',
                                size: size,
                                timeStamp: details.timeStamp,
                                tabId: details.tabId,
                                pageTitle: pageTitle,
                                pageUrl: pageUrl
                            };
                            if (!isDrmMedia) {
                                existingRequests.push(mediaRequest);
                            }
                        }

                        if (isDrmMedia) {
                            browser.storage.session.remove(details.url);
                        } else {
                            let requestsObj = {};
                            requestsObj[details.url] = existingRequests;
                            browser.storage.session.set(requestsObj);
                        }

                        if (shouldSaveNow || updated) {
                            showMediaNotification(details, currentSettings);
                        }
                    });
                });
            } catch (e) {
                console.error("Error in onHeadersReceived handler:", e);
            }
        };

        browser.webRequest.onHeadersReceived.addListener(
            headersReceivedListener,
            { urls: urlList },
            ['responseHeaders']
        );
    });
}

browser.downloads.onCreated.addListener((downloadItem) => {
    if (downloadItem.url && (downloadItem.url.startsWith('http') || downloadItem.url.startsWith('blob'))) {
        activeDownloads.set(downloadItem.id, {
            url: downloadItem.url,
            loaded: 0,
            total: downloadItem.totalBytes,
            isNative: true
        });
    }
});

browser.downloads.onChanged.addListener((delta) => {
    const item = activeDownloads.get(delta.id);
    if (!item) return;

    if (delta.bytesReceived) item.loaded = delta.bytesReceived.current;
    if (delta.totalBytes) item.total = delta.totalBytes.current;

    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        let errorMsg = delta.error ? delta.error.current : null;
        if (delta.state.current === 'interrupted' && (errorMsg === 'USER_CANCELED' || errorMsg === 'USER_SHUTDOWN')) {
            errorMsg = 'USER_CANCELED';
        }

        browser.runtime.sendMessage({
            action: delta.state.current === 'complete' ? 'downloadComplete' : 'downloadError',
            id: delta.id,
            url: item.url,
            error: errorMsg
        }).catch(() => {});
        if (delta.state.current === 'complete') {
            removeMediaRequest(item.url);
        }
        activeDownloads.delete(delta.id);
    } else {
        browser.runtime.sendMessage({
            action: 'downloadProgress',
            id: delta.id,
            url: item.url,
            loaded: item.loaded,
            total: item.total
        }).catch(() => {});
    }
});

const cancelledZipDownloads = new Set();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'customStatus') {
        const id = message.id;
        if (id) {
            let item = activeDownloads.get(id);
            if (!item) {
                item = {
                    id: id,
                    url: id,
                    loaded: 0,
                    total: 100,
                    percent: 0,
                    status: 'downloading',
                    isParallel: false,
                    isPaused: false,
                    mediaType: getMediaType(id) || 'audio'
                };
                activeDownloads.set(id, item);
            }
            if (message.percent !== undefined) {
                item.percent = message.percent;
                item.loaded = message.percent;
                item.total = 100;
            }
            if (message.text) {
                item.status = message.text;
            }
            if (message.indeterminate) {
                item.loaded = 0;
                item.total = 0;
            }
        }
        return;
    }
    if (message.action === 'download_arraybuffer') {
        const blob = new Blob([message.arrayBuffer], { type: message.mime || 'application/octet-stream' });
        const downloadId = 'tab_' + Date.now();
        storeInCache(downloadId, blob, message.mime).then(() => {
            const isAndroid = /Android/i.test(navigator.userAgent);
            browser.tabs.create({
                url: browser.runtime.getURL(`download.html?id=${downloadId}&url=${encodeURIComponent(downloadId)}&filename=${encodeURIComponent(message.filename)}`),
                active: isAndroid
            });
            sendResponse({ success: true });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }
    if (message.action === 'heartbeat') {
        sendResponse({ status: 'alive' });
        return true;
    }
    if (message.action === 'drmDetected' && sender.tab) {
        const tabId = sender.tab.id;
        if (tabsWithDrm.has(tabId)) return;
        tabsWithDrm.add(tabId);

        browser.storage.session.get(null, (items) => {
            const keysToRemove = [];
            for (const [url, requests] of Object.entries(items)) {
                if (requests && requests.length > 0 && requests[0].tabId === tabId) {
                    const mType = getMediaType(url);
                    if (mType === 'video' || mType === 'audio' || mType === 'stream') {
                        keysToRemove.push(url);
                    }
                }
            }
            if (keysToRemove.length > 0) browser.storage.session.remove(keysToRemove);
        });

        const drmMsg = browser.i18n.getMessage("mediaNotificationDrmMessage") || "DRM Protected";
        const drmTitle = browser.i18n.getMessage("drmWarningTitle") || "DRM Detected";

        for (const [notificationId, data] of notificationUrls.entries()) {
            if (data.tabId === tabId) {
                browser.notifications.clear(notificationId);
                browser.notifications.create({
                    type: "basic",
                    iconUrl: browser.runtime.getURL("icons/icon.png"),
                    title: drmTitle,
                    message: drmMsg,
                    buttons: []
                });
                notificationUrls.delete(notificationId);
            }
        }

        browser.scripting.executeScript({
            target: { tabId: tabId },
            func: (msg) => {
                const toasts = document.querySelectorAll('.mdu-toast');
                toasts.forEach(toast => {
                    const filename = toast.querySelector('.mdu-toast-filename');
                    const title = toast.querySelector('.mdu-toast-title');
                    const actions = toast.querySelector('.mdu-toast-actions');
                    if (filename) {
                        filename.textContent = msg;
                        filename.style.whiteSpace = 'normal';
                    }
                    if (title) title.textContent = "DRM Detected";
                    if (actions) actions.innerHTML = '';
                    toast.style.width = '420px';
                });
            },
            args: [drmMsg]
        }).catch(() => {});

        return;
    }
    if (message.action === 'addToHistory') {
        addToHistory(message.item);
        return;
    }
    if (message.action === 'downloadHlsStream') {
        const pageUrl = sender.tab ? sender.tab.url : "";
        const pageTitle = sender.tab ? sender.tab.title : "";

        let finalName = message.filename;
        if (!finalName.toLowerCase().endsWith('.mp4')) {
            const dotIdx = finalName.lastIndexOf('.');
            if (dotIdx !== -1) {
                finalName = finalName.substring(0, dotIdx);
            }
            finalName += '.mp4';
        }

        addToHistory({ url: message.url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });

        browser.runtime.sendMessage({
            action: 'startPersistentStreamJob', url: message.url, filename: finalName,
            quality: message.quality || 'highest', request: message.request || {}, downloadMethod: 'browser'
        });
        return;
    }
    if (message.action === 'startDownloadFromToast') {
        const url = message.url;
        const tabId = sender.tab ? sender.tab.id : null;
        browser.storage.session.get(url, (result) => {
            const requests = result[url] || [];
            const request = requests.length > 0 ? requests[requests.length - 1] : null;
            browser.storage.local.get(['download-method', 'filename-template', 'gdrive-stream', 'save-to-gdrive', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token', 'stream-download'], async (res) => {
                let method = res['download-method'] || 'browser';
                const isGdriveStream = res['save-to-gdrive'] === '1' && res['gdrive-stream'] === '1' && res['gdrive_token'];
                if (isGdriveStream) method = 'fetch';

                const template = (res['filename-template'] && res['filename-template'] !== '0') ? res['filename-template'] : '';
                const originalName = await getAutomaticFilename(url, tabId, request || {});
                let finalName = originalName;

                let pageUrl = sender.tab ? sender.tab.url : "";
                let pageTitle = sender.tab ? sender.tab.title : "";

                if (template) {
                    finalName = await generateTemplateName(template, url, originalName, tabId);
                }

                const streamPref = res['stream-download'] || 'offline';
                const mType = getMediaType(url);

                if (url.toLowerCase().includes('.m3u8') && streamPref === 'offline') {
                    addToHistory({ url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });
                    browser.runtime.sendMessage({
                        action: 'startPersistentStreamJob', url, filename: finalName,
                        quality: 'highest', request: request || {}, downloadMethod: method
                    });
                    return;
                }
                addToHistory({ url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });

                if (method === 'fetch') {
                    handleFetchDownload(url, finalName, request);
                } else {
                    browser.downloads.download({
                        url: url,
                        filename: sanitizeFilename(finalName),
                        saveAs: false
                    });
                }
            });
        });
        return;
    }

    if (message.action === 'reportDetectedMedia') {
        getSettings(async function(settings) {
            let { urls, pageTitle, pageUrl } = message;
            if (!urls || !Array.isArray(urls)) return;
            const exclusionContext = {
                pageTitle: pageTitle || sender.tab?.title,
                pageUrl: pageUrl || sender.tab?.url,
                tabId: sender.tab?.id
            };
            if (await detectionExclusions.shouldSkip(exclusionContext)) return;
            urls = urls.filter(url => !detectionExclusions.matchesDetection({ ...exclusionContext, url }));
            if (!urls.length) return;
            if (settings.ignoreDisabledTypes) {
                urls = urls.filter(u => {
                    const mType = getMediaType(u);
                    return !isMediaTypeDisabled(mType, settings);
                });
            }

            let senderReferer = pageUrl || sender.tab?.url || "";
            const tabId = sender.tab?.id;
            
            if (tabId && pageTitle) {
                tabMetadata.set(tabId, { title: pageTitle, url: pageUrl || sender.tab?.url });
            }

            const isDrmTab = tabId && tabsWithDrm.has(tabId);
            let senderOrigin = "";
            try { if (senderReferer) senderOrigin = new URL(senderReferer).origin; } catch(e) {}

            browser.storage.session.get(null, (items) => {
                const updates = {};
                let hasNew = false;

                urls.forEach(url => {
                    const mType = getMediaType(url);
                    if (isMediaTypeDisabled(mType, settings)) return;
                    const isDrmMedia = isDrmTab && (mType === 'video' || mType === 'audio' || mType === 'stream');

                    if (!items[url] && !isDrmMedia) {
                        updates[url] = [{
                            url: url,
                            method: 'GET',
                            requestHeaders: senderReferer ? [{name: 'Referer', value: senderReferer}, {name: 'Origin', value: senderOrigin}] : null,
                            responseHeaders: null,
                            requestBody: null,
                            cookie: '',
                            size: 'unknown',
                            timeStamp: Date.now(),
                            tabId: tabId,
                            pageTitle: pageTitle || sender.tab?.title || "",
                            pageUrl: pageUrl || sender.tab?.url || ""
                        }];
                        hasNew = true;
                    }
                });

                if (hasNew) {
                    browser.storage.session.set(updates);
                }
            });
        });
        return;
    }
        if (message.action === 'getMediaRequests') {
        browser.storage.session.get(null, async function (items) {
            await detectionExclusions.ready;
            items = Object.fromEntries(Object.entries(items || {}).map(([url, requests]) => [
                url, Array.isArray(requests) ? requests.filter(request => !detectionExclusions.matches({ ...request, url })) : []
            ]).filter(([, requests]) => requests.length));
            if (cachedSettings.ignoreDisabledTypes) {
                const filtered = {};
                for (const [url, reqs] of Object.entries(items || {})) {
                    const contentType = (reqs && reqs.length > 0 && reqs[0].responseHeaders)
                        ? (reqs[0].responseHeaders.find(h => h.name && h.name.toLowerCase() === 'content-type')?.value || '')
                        : '';
                    const mType = getMediaType(url, contentType);
                    if (!isMediaTypeDisabled(mType, cachedSettings)) {
                        filtered[url] = reqs;
                    }
                }
                sendResponse(filtered);
            } else {
                sendResponse(items);
            }
        });
        return true;
    }

    if (message.action === 'getSpoofedHeaders') {
        let headers = urlToHeaderMap.get(message.url) || null;
        if (!headers && (message.url.includes('googlevideo.com') || message.url.includes('youtube.com'))) {
            headers = {
                'referer': 'https://www.youtube.com/',
                'origin': 'https://www.youtube.com',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };
            urlToHeaderMap.set(message.url, headers);
            if (typeof registerHeaderSpoofRules === 'function') {
                registerHeaderSpoofRules(message.url, headers);
            }
        }
        sendResponse(headers);
        return;
    }

    if (message.action === 'fetchText') {
        const fetchHeaders = urlToHeaderMap.get(message.url) || {};
        const options = { headers: {} };
        if (fetchHeaders.cookie) options.headers['Cookie'] = fetchHeaders.cookie;
        if (fetchHeaders.referer) {
            options.headers['Referer'] = fetchHeaders.referer;
        }
        if (fetchHeaders.origin) options.headers['Origin'] = fetchHeaders.origin;
        options.credentials = 'include';
        
        fetch(message.url, options)
            .then(res => {
                if (!res.ok) throw new Error("HTTP error " + res.status);
                return res.text();
            })
            .then(text => sendResponse({ text: text }))
            .catch(e => sendResponse({ error: e.message }));
        return true;
    }

    if (message.action === 'startFetchDownload') {
        handleFetchDownload(message.url, message.filename, message.request, message.downloadId, false, false, null, message.mediaType);
        return;
    }

    if (message.action === 'startDownloadAll') {
        const downloadId = 'zip_' + Date.now();
        handleDownloadAllAsZip(message.items, downloadId);
        sendResponse({ downloadId });
        return;
    }

    if (message.action === 'cancelDownload') {
        let targetId = message.id;
        let isNative = false;

        if (!targetId && message.url) {
            for (let [id, val] of activeDownloads) {
                if (val.url === message.url) {
                    targetId = id;
                    isNative = !!val.isNative;
                    break;
                }
            }
        }

        if (targetId) {
            const item = activeDownloads.get(targetId);
            if (item) {
                if (item.isZip) cancelledZipDownloads.add(targetId);
                if (isNative || item.isNative) {
                    browser.downloads.cancel(targetId).catch(() => {});
                } else if (item.abortController) {
                    item.abortController.abort();
                }

                if (item.cloudController) {
                    item.cloudController.cancel();
                }

                activeDownloads.delete(targetId);
                removeDownloadState(targetId);
                cleanupDownload(targetId);
            }
        }
        return;
    }

    if (message.action === 'pauseDownload') {
        const id = message.id;
        const item = activeDownloads.get(id);
        if (item) {
            if (item.abortController) {
                item.isPaused = true;
                item.abortController.abort();
            }
            if (item.cloudController) {
                item.isPaused = true;
                item.cloudController.pause();
                

                browser.runtime.sendMessage({
                    action: item.isZip ? 'zipProgress' : 'downloadProgress',
                    id: id,
                    loaded: parseInt(item.loaded) || 0,
                    total: parseInt(item.total) || 0,
                    status: 'uploading',
                    isPaused: true,
                    percent: item.percent
                }).catch(() => {});
            }

            saveDownloadState(id, item).catch(() => {});

            browser.runtime.sendMessage({
                action: 'downloadPaused',
                id: id,
                loaded: parseInt(item.loaded) || 0,
                total: parseInt(item.total) || 0
            }).catch(() => {});
        }
        return;
    }

    if (message.action === 'resumeActiveDownload') {
        const id = message.id;
        const item = activeDownloads.get(id);
        if (item && item.isPaused) {
            item.isPaused = false;

            item.isManualResume = true;
            if (item.cloudController) {
                item.cloudController.resume();
                browser.runtime.sendMessage({
                    action: item.isZip ? 'zipProgress' : 'downloadProgress',
                    id: id,
                    loaded: parseInt(item.loaded) || 0,
                    total: parseInt(item.total) || 0,
                    status: 'uploading',
                    isPaused: false,
                    percent: item.percent
                }).catch(() => {});
            } else {
                handleFetchDownload(item.url, item.filename, item.originalRequest, id, true, true, item.loaded, item.mediaType);
            }
        }
        return;
    }

    if (message.action === 'getActiveDownloads') {
        const downloadsObj = {};
        for (let [id, value] of activeDownloads) {
            downloadsObj[id] = {
                id: id,
                loaded: parseInt(value.loaded) || 0,
                total: parseInt(value.total) || 0,
                url: value.url,
                filename: value.filename,
                isParallel: !!value.isParallel,
                isPaused: !!value.isPaused,
                mediaType: value.mediaType || getMediaType(value.url, []),
                percent: value.percent,
                status: value.status,
                statusText: value.statusText,
                currentFile: value.currentFile,
                isStreamJob: !!value.isStreamJob,
                isZip: !!value.isZip,
                isPersistentZipJob: !!value.isPersistentZipJob
            };
        }
        sendResponse(downloadsObj);
        return;
    }

    if (message.action === 'downloadComplete' || message.action === 'downloadError') {
        const id = message.id || message.url;
        if (id) {
            activeDownloads.delete(id);
            removeDownloadState(id);
            
            if (message.action === 'downloadComplete') {
                if (message.url) {
                    removeMediaRequest(message.url);
                } else if (id && id.startsWith('http')) {
                    removeMediaRequest(id);
                }
            }

            if (message.cloud || message.background) {
                cleanupDownload(id);
            }
        }
        return;
    }

    if (message.action === 'registerDownloadTab') {
        if (sender.tab && message.id) {
            if (!downloadTabs.has(sender.tab.id)) {
                downloadTabs.set(sender.tab.id, new Set());
            }
            downloadTabs.get(sender.tab.id).add(message.id);
        }
        return;
    }

    if (message.action === 'registerDownloadManagerTab') {
        if (sender.tab) {
            activeBridgeTabId = sender.tab.id;
        }
        return;
    }

    if (message.action === 'confirmZipSkipResponse') {
        if (window.zipConfirmResolver) {
            window.zipConfirmResolver(message.result);
            delete window.zipConfirmResolver;
        }
        return;
    }
});

async function askUserToContinue(filename, error) {
    return new Promise((resolve) => {
        window.zipConfirmResolver = resolve;
        browser.runtime.sendMessage({
            action: 'confirmZipSkip',
            filename: filename,
            error: error
        }).catch(() => {

            if (window.zipConfirmResolver) {
                window.zipConfirmResolver(false);
                delete window.zipConfirmResolver;
            }
        });

        setTimeout(() => {
            if (window.zipConfirmResolver === resolve) {
                resolve(false);
                delete window.zipConfirmResolver;
            }
        }, 30000);
    });
}

async function handleDownloadAllAsZip(items, downloadId) {
    await ensureClientZipLoaded();
    try {
        activeDownloads.set(downloadId, { loaded: 0, total: items.length, url: 'zip://' + downloadId, isZip: true });

        const zipEntriesGenerator = async function* () {
            let skipAllErrors = false;
            const usedNames = new Set();
            for (let i = 0; i < items.length; i++) {
                if (cancelledZipDownloads.has(downloadId)) throw new Error("Cancelled");
                const item = items[i];
                const url = item.url;
                const originalRequest = item.originalRequest || item.request;
                const originalFileName = item.filename || "file";
                let filename = originalFileName;

                browser.runtime.sendMessage({
                    action: 'zipProgress',
                    id: downloadId,
                    loaded: i,
                    total: items.length,
                    status: 'downloading',
                    currentFile: filename
                }).catch(() => {});

                try {
                    if (/\.(m3u8|mpd)(?:$|[?#])/i.test(url)) {
                        const processedFiles = await processStreamItemForZip({
                            ...item, request: originalRequest, filename
                        }, downloadId);
                        if (cancelledZipDownloads.has(downloadId)) throw new Error("Cancelled");
                        for (const file of processedFiles) {
                            const resolvedName = file.filename || filename;
                            let entryName = resolvedName;
                            let entryCounter = 1;
                            while (usedNames.has(entryName)) {
                                const parts = resolvedName.split('.');
                                const ext = parts.length > 1 ? '.' + parts.pop() : '';
                                entryName = `${parts.join('.')}_${entryCounter}${ext}`;
                                entryCounter++;
                            }
                            usedNames.add(entryName);
                            yield { name: entryName, input: new Blob([file.arrayBuffer], { type: file.mime || 'application/octet-stream' }) };
                        }
                        activeDownloads.get(downloadId).loaded = i + 1;
                        continue;
                    }
                    const fetchOptions = {
                        method: originalRequest ? originalRequest.method : 'GET',
                        headers: {},
                        credentials: 'include'
                    };

                    if (originalRequest && originalRequest.requestHeaders) {
                        originalRequest.requestHeaders.forEach(h => {
                            const name = h.name.toLowerCase();
                            if (!['cookie', 'referer', 'range', 'content-length'].includes(name)) {
                                fetchOptions.headers[h.name] = h.value;
                            }
                        });
                    }

                    const storedHeaders = urlToHeaderMap.get(url);
                    if (storedHeaders) {
                        if (storedHeaders.cookie) fetchOptions.headers['Cookie'] = storedHeaders.cookie;
                        if (storedHeaders.referer) {
                            fetchOptions.headers['Referer'] = storedHeaders.referer;
                            fetchOptions.referrer = storedHeaders.referer;
                        }
                        if (storedHeaders.origin) fetchOptions.headers['Origin'] = storedHeaders.origin;
                    }

                    if (originalRequest && originalRequest.method !== 'GET' && originalRequest.requestBody) {
                        if (originalRequest.requestBody.type === 'formData') {
                            const formData = new FormData();
                            for (const key in originalRequest.requestBody.data) {
                                originalRequest.requestBody.data[key].forEach(val => formData.append(key, val));
                            }
                            fetchOptions.body = formData;
                        } else if (originalRequest.requestBody.type === 'base64') {
                            const bin = atob(originalRequest.requestBody.data);
                            const u = new Uint8Array(bin.length);
                            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                            fetchOptions.body = u;
                        }
                    }

                    const response = await fetch(url, fetchOptions);
                    if (!response.ok) {
                        console.warn(`Failed to download ${url} for ZIP. Status: ${response.status}`);
                        if (skipAllErrors) continue;

                        const result = await askUserToContinue(filename, `Server returned ${response.status}`);
                        if (result === 'continue-all') {
                            skipAllErrors = true;
                            continue;
                        }
                        if (result === 'continue') continue;
                        else throw new Error("Cancelled by user after error");
                    }

                    const mimeType = response.headers.get('Content-Type') || '';
                    const resolvedFileName = ensureFileExtension(originalFileName, mimeType);

                    filename = resolvedFileName;
                    let counter = 1;
                    while (usedNames.has(filename)) {
                        const parts = resolvedFileName.split('.');
                        if (parts.length > 1) {
                            const ext = parts.pop();
                            filename = `${parts.join('.')}_${counter}.${ext}`;
                        } else {
                            filename = `${resolvedFileName}_${counter}`;
                        }
                        counter++;
                    }
                    usedNames.add(filename);

                    yield { name: filename, input: response };

                    activeDownloads.get(downloadId).loaded = i + 1;
                } catch (err) {
                    if (cancelledZipDownloads.has(downloadId) || err.message === "Cancelled") throw new Error("Cancelled");
                    if (err.message === "Cancelled by user after error") throw err;
                    console.warn(`Error fetching ${url} for ZIP:`, err);
                    if (skipAllErrors) continue;

                    const result = await askUserToContinue(filename, err.message);
                    if (result === 'continue-all') {
                        skipAllErrors = true;
                        continue;
                    }
                    if (result === 'continue') continue;
                    else throw new Error("Cancelled by user after error");
                }
            }
        };

        browser.runtime.sendMessage({
            action: 'zipProgress',
            id: downloadId,
            loaded: items.length,
            total: items.length,
            status: 'generating'
        }).catch(() => {});

        const zipResponse = downloadZip(zipEntriesGenerator());
        const zipBlob = await zipResponse.blob();

        if (zipBlob.size < 100) {
             throw new Error(browser.i18n.getMessage("zipEmptyError") || "Failed to download any of the selected files or ZIP is empty.");
        }

        const settings = await browser.storage.local.get(['save-to-gdrive', 'gdrive-stream', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token']);
        const gdriveEnabled = settings['save-to-gdrive'] === '1' && settings['gdrive_token'];
        const isGdriveStream = gdriveEnabled && settings['gdrive-stream'] === '1';
        const dropboxEnabled = settings['save-to-dropbox'] === '1' && settings['dropbox_token'];
        const isDropboxStream = dropboxEnabled && settings['dropbox-stream'] === '1';
        const zipName = `downloads_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

        if (isGdriveStream || isDropboxStream) {
            let gdriveSessionUri = null;
            let dropboxSessionId = null;
            let useDropboxStream = isDropboxStream;
            try {
                if (isGdriveStream) gdriveSessionUri = await startGDriveStreamUpload(zipName, null, 'application/zip');
                if (useDropboxStream) dropboxSessionId = await startDropboxStreamUpload(zipName);
                const controller = new CloudUploadController();
                const activeItem = activeDownloads.get(downloadId);
                if (activeItem) activeItem.cloudController = controller;

                browser.runtime.sendMessage({
                    action: 'zipProgress',
                    id: downloadId,
                    loaded: items.length,
                    total: items.length,
                    status: 'uploading',
                    percent: 0
                }).catch(() => {});

                const response = downloadZip(zipEntriesGenerator());
                const reader = response.body.getReader();
                let offset = 0;
                let zipBuffer = [];
                let zipBufferSize = 0;
                const GDRIVE_CHUNK_UNIT = 256 * 1024;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    zipBuffer.push(value);
                    zipBufferSize += value.byteLength;

                    if (zipBufferSize >= GDRIVE_CHUNK_UNIT) {
                        const fullData = new Uint8Array(zipBufferSize);
                        let pos = 0;
                        for (const b of zipBuffer) {
                            fullData.set(b, pos);
                            pos += b.byteLength;
                        }

                        const uploadSize = Math.floor(zipBufferSize / GDRIVE_CHUNK_UNIT) * GDRIVE_CHUNK_UNIT;
                        const dataToUpload = fullData.slice(0, uploadSize);
                        const remainder = fullData.slice(uploadSize);

                        if (gdriveSessionUri) await uploadStreamChunk(gdriveSessionUri, dataToUpload, offset);
                        if (dropboxSessionId) await appendDropboxStream(dropboxSessionId, offset, dataToUpload);
                        offset += uploadSize;

                        zipBuffer = [remainder];
                        zipBufferSize = remainder.byteLength;

                        browser.runtime.sendMessage({
                            action: 'zipProgress',
                            id: downloadId,
                            loaded: offset,
                            status: 'uploading',
                            percent: Math.min(99, Math.round((offset / (zipBlob.size || offset * 1.1)) * 100))
                        }).catch(() => {});
                    }
                }

                if (zipBufferSize > 0) {
                    const finalData = new Uint8Array(zipBufferSize);
                    let pos = 0;
                    for (const b of zipBuffer) {
                        finalData.set(b, pos);
                        pos += b.byteLength;
                    }
                    if (gdriveSessionUri) await uploadStreamChunk(gdriveSessionUri, finalData, offset);
                    if (dropboxSessionId) await appendDropboxStream(dropboxSessionId, offset, finalData);
                    offset += zipBufferSize;
                }

                if (gdriveSessionUri) await uploadStreamChunk(gdriveSessionUri, new Uint8Array(0), offset, offset);
                if (dropboxSessionId) await finishDropboxStream(dropboxSessionId, offset, zipName);
                activeDownloads.delete(downloadId);
                const cloudService = dropboxSessionId ? 'dropbox' : (gdriveSessionUri ? 'gdrive' : true);
                browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName, cloud: cloudService }).catch(() => {});
                return;
            } catch (e) {
                console.error("GDrive ZIP stream upload failed, falling back to local:", e);
            }
        }

        
        if (dropboxEnabled) {
            const controller = new CloudUploadController();
            const activeItem = activeDownloads.get(downloadId);
            if (activeItem) activeItem.cloudController = controller;

            try {
                browser.runtime.sendMessage({
                    action: 'zipProgress',
                    id: downloadId,
                    loaded: items.length,
                    total: items.length,
                    status: 'uploading',
                    percent: 0
                }).catch(() => {});

                await uploadToDropbox(zipBlob, zipName, (percent, loaded, total) => {
                    const item = activeDownloads.get(downloadId);
                    if (item) {
                        item.percent = percent;
                        item.loaded = loaded;
                        item.total = total;
                    }
                    browser.runtime.sendMessage({
                        action: 'zipProgress',
                        id: downloadId,
                        loaded: loaded,
                        total: total,
                        status: 'uploading',
                        percent: percent,
                        isPaused: item ? !!item.isPaused : false
                    }).catch(() => {});
                }, controller);

                activeDownloads.delete(downloadId);
                browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName, cloud: 'dropbox' }).catch(() => {});
                return;
            } catch (error) {
                console.error("Dropbox ZIP upload failed:", error);
            }
        }

        if (gdriveEnabled) {
            const controller = new CloudUploadController();
            const activeItem = activeDownloads.get(downloadId);
            if (activeItem) activeItem.cloudController = controller;

            try {
                browser.runtime.sendMessage({
                    action: 'zipProgress',
                    id: downloadId,
                    loaded: items.length,
                    total: items.length,
                    status: 'uploading',
                    percent: 0
                }).catch(() => {});

                await uploadToGDrive(zipBlob, zipName, (percent, loaded, total) => {
                    const item = activeDownloads.get(downloadId);
                    if (item) {
                        item.percent = percent;
                        item.loaded = loaded;
                        item.total = total;
                    }
                    browser.runtime.sendMessage({
                        action: 'zipProgress',
                        id: downloadId,
                        loaded: loaded,
                        total: total,
                        status: 'uploading',
                        percent: percent,
                        isPaused: item ? !!item.isPaused : false
                    }).catch(() => {});
                }, controller);
                
                activeDownloads.delete(downloadId);
                browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName, cloud: 'gdrive' }).catch(() => {});
                return;
            } catch (error) {
                console.error("GDrive ZIP upload failed, falling back to local download:", error);
            }
        }

        await storeInCache(downloadId, zipBlob, "application/zip");

        pendingSaveQueue.push({ id: downloadId, url: 'zip://' + downloadId, filename: zipName });
        processSaveQueue();

        activeDownloads.delete(downloadId);
        browser.runtime.sendMessage({ action: 'zipComplete', id: downloadId, filename: zipName }).catch(() => {});

    } catch (error) {
        console.error("Background ZIP error:", error);
        activeDownloads.delete(downloadId);
        browser.runtime.sendMessage({ action: 'zipError', id: downloadId, error: error.message === 'Cancelled' ? 'USER_CANCELED' : error.message }).catch(() => {});
    } finally {
        cancelledZipDownloads.delete(downloadId);
    }
}

function getFileName(url, maxLength = 30) {
    try {
        let parsedUrl = new URL(url);
        let fileName = parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1).split('?')[0];
        fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        if (!fileName) fileName = parsedUrl.hostname;
        if (fileName.length > maxLength) fileName = fileName.substring(0, maxLength) + '…';
        return decodeURIComponent(fileName);
    } catch (e) { return browser.i18n.getMessage("defaultMediaName") || "Media File"; }
}

const pendingSaveQueue = [];
let activeBridgeTabId = null;
const downloadTabs = new Map(); // tabId -> downloadId

async function cleanupDownload(id) {
    if (!id) return;
    try {
        const db = await getDB();
        const delTx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
        delTx.objectStore(STORE_NAME).delete(id);
        const chunkRange = IDBKeyRange.bound([id, 0], [id, Infinity]);
        delTx.objectStore(CHUNK_STORE_NAME).delete(chunkRange);
    } catch (e) { console.warn("Cleanup failed:", e); }
}

async function triggerHiddenDownload(id, filename) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isFirefox = typeof browser.runtime.getBrowserInfo === 'function' || !browser.offscreen;

    if (isAndroid) {
        return false;
    }

    if (isFirefox && typeof URL !== 'undefined' && URL.createObjectURL) {
        try {
            const db = await getDB();

            const item = await new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], "readonly");
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(id);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            const chunks = [];
            await new Promise((resolve, reject) => {
                const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
                const store = tx.objectStore(CHUNK_STORE_NAME);
                const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
                const request = store.openCursor(range);
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) { chunks.push(cursor.value.data); cursor.continue(); }
                    else resolve();
                };
                request.onerror = () => reject(request.error);
            });

            if (chunks.length === 0 && (!item || !item.data)) return false;

            let blobType = (item && item.mime) || "application/octet-stream";
            if (filename.toLowerCase().endsWith('.m4a') && blobType.includes('mp4')) {
                blobType = "application/octet-stream";
            }
            const finalBlob = chunks.length > 0
                ? new Blob(chunks, { type: blobType })
                : item.data;

            const blobUrl = URL.createObjectURL(finalBlob);
            const finalDownloadFilename = ensureFileExtension(filename, blobType);

            try {
                await browser.downloads.download({
                    url: blobUrl,
                    filename: sanitizeFilename(finalDownloadFilename),
                    saveAs: false
                });

                setTimeout(() => {
                    URL.revokeObjectURL(blobUrl);
                    cleanupDownload(id);
                }, 30000);
                return true;
            } catch (e) {
                URL.revokeObjectURL(blobUrl);
                throw e;
            }
        } catch (e) {
            console.error("Direct background download failed:", e);
        }
    }

    if (typeof browser.offscreen !== 'undefined') {
        try {
            const hasOffscreen = await browser.offscreen.hasDocument().catch(() => false);
            if (!hasOffscreen) {
                await browser.offscreen.createDocument({
                    url: 'offscreen.html',
                    reasons: ['BLOBS'],
                    justification: 'Triggering download for fetched media blob'
                });
            }

            const response = await browser.runtime.sendMessage({
                action: 'triggerOffscreenDownload',
                data: { id, filename }
            }).catch(e => ({ error: e.message }));

            if (response && response.success && response.url) {
                await browser.downloads.download({
                    url: response.url,
                    filename: sanitizeFilename(response.filename || filename),
                    saveAs: false
                });

                setTimeout(() => {
                    cleanupDownload(id);
                }, 10000);
                return true;
            } else if (response && response.error) {
                console.error("Offscreen download returned error:", response.error);
            }
        } catch (e) {
            console.error("Offscreen download failed:", e);
        }
    }

    return false;
}


function uploadToDropbox(blob, filename, onProgress, controller, isRetry = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            if (!res.dropbox_token) {
                return reject(new Error("Dropbox token not found. Please login in settings."));
            }
            const token = res.dropbox_token;

            const uploadUrl = 'https://content.dropboxapi.com/2/files/upload';
            const apiArgRaw = JSON.stringify({
                path: "/" + filename.replace(/[/\\?%*:|"<>]/g, '-'),
                mode: "add",
                autorename: true,
                mute: false
            });
            const apiArg = apiArgRaw.replace(/[\u007f-\uffff]/g, function(c) { 
                return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
            });

            const xhr = new XMLHttpRequest();
            if (controller) controller.xhr = xhr;
            xhr.open('POST', uploadUrl);
            xhr.setRequestHeader('Authorization', "Bearer " + token);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('Dropbox-API-Arg', apiArg);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && onProgress) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    onProgress(percent, event.loaded, event.total);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200 || xhr.status === 201) {
                    resolve();
                } else if (xhr.status === 401 && !isRetry) {
                    reauthDropbox().then(() => {
                        uploadToDropbox(blob, filename, onProgress, controller, true).then(resolve).catch(reject);
                    }).catch(() => {
                        reject(new Error("Dropbox session expired. Please re-login in settings."));
                    });
                } else {
                    reject(new Error("Dropbox Upload Error: " + xhr.statusText));
                }
            };

            xhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToDropbox(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                }
            };

            xhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToDropbox(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                } else {
                    reject(new Error("Network error during Dropbox upload"));
                }
            };

            xhr.send(blob);

        } catch (error) {
            reject(error);
        }
    });
}

async function uploadFromCacheToDropbox(downloadId, filename) {
    try {
        const blob = await assembleBlobFromCache(downloadId);
        if (!blob) throw new Error("File data not found in cache");
        
        const controller = new CloudUploadController();
        const activeItem = activeDownloads.get(downloadId);
        if (activeItem) activeItem.cloudController = controller;

        await uploadToDropbox(blob, filename, (percent, loaded, total) => {
            const item = activeDownloads.get(downloadId);
            if (item) {
                item.percent = percent;
                item.loaded = loaded;
                item.total = total;
            }
            browser.runtime.sendMessage({
                action: 'downloadProgress',
                id: downloadId,
                loaded: loaded,
                total: total,
                percent: percent,
                status: 'uploading',
                isPaused: item ? !!item.isPaused : false
            }).catch(() => {});
        }, controller);
        return true;
    } catch (e) {
        console.error("Dropbox upload from cache failed:", e);
        throw e;
    }
}

async function uploadFromCacheToGDrive(downloadId, filename) {
    try {
        const blob = await assembleBlobFromCache(downloadId);
        if (!blob) throw new Error("File data not found in cache");
        
        const controller = new CloudUploadController();
        const activeItem = activeDownloads.get(downloadId);
        if (activeItem) activeItem.cloudController = controller;

        await uploadToGDrive(blob, filename, (percent, loaded, total) => {
            const item = activeDownloads.get(downloadId);
            if (item) {
                item.percent = percent;
                item.loaded = loaded;
                item.total = total;
            }
            browser.runtime.sendMessage({
                action: 'downloadProgress',
                id: downloadId,
                loaded: loaded,
                total: total,
                percent: percent,
                status: 'uploading',
                isPaused: item ? !!item.isPaused : false
            }).catch(() => {});
        }, controller);
        return true;
    } catch (e) {
        console.error("GDrive upload from cache failed:", e);
        throw e;
    }
}

async function assembleBlobFromCache(downloadId) {
    const db = await getDB();
    
    const item = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(downloadId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (item && item.data) {
        return item.data;
    }

    const chunks = await new Promise((resolve, reject) => {
        const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
        const store = tx.objectStore(CHUNK_STORE_NAME);
        const range = IDBKeyRange.bound([downloadId, 0], [downloadId, Infinity]);
        const req = store.getAll(range);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (chunks.length === 0) return null;

    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    
    const blobParts = chunks.map(c => c.data);
    return new Blob(blobParts, { type: item ? item.mime : 'application/octet-stream' });
}

async function processSaveQueue() {
    if (pendingSaveQueue.length === 0) return;

    if (activeBridgeTabId !== null) {
        const nextDownload = pendingSaveQueue.shift();
        try {
            await browser.tabs.sendMessage(activeBridgeTabId, {
                action: 'startDownload',
                id: nextDownload.id,
                url: nextDownload.url,
                filename: nextDownload.filename
            });
            setTimeout(processSaveQueue, 100);
        } catch (err) {
            pendingSaveQueue.unshift(nextDownload);
            activeBridgeTabId = null;
            setTimeout(processSaveQueue, 500);
        }
        return;
    }

    const nextDownload = pendingSaveQueue.shift();
    const { id, url, filename, isStreamUploaded, cloud } = nextDownload;

    const settings = await browser.storage.local.get(['save-to-gdrive', 'save-to-dropbox']);
    if (settings['save-to-gdrive'] === '1' || settings['save-to-dropbox'] === '1' || cloud) {
        if (isStreamUploaded) {
            browser.runtime.sendMessage({
                action: 'downloadComplete',
                id: id,
                url: url,
                filename: filename,
                cloud: true
            }).catch(() => {});

            activeDownloads.delete(id);
            removeDownloadState(id);
            removeMediaRequest(url);

            setTimeout(processSaveQueue, 1000);
            return;
        }

        try {
            const activeItem = activeDownloads.get(id);
            if (activeItem) {
                activeItem.status = 'uploading';
            }

            browser.runtime.sendMessage({
                action: 'downloadProgress',
                id: id,
                loaded: 0,
                percent: 0,
                status: 'uploading'
            }).catch(() => {});

            if (settings['save-to-gdrive'] === '1') { await uploadFromCacheToGDrive(id, filename); } else if (settings['save-to-dropbox'] === '1') { await uploadFromCacheToDropbox(id, filename); } else { throw new Error('Cloud save not enabled'); }
            
            browser.runtime.sendMessage({
                action: 'downloadComplete',
                id: id,
                url: url,
                filename: filename,
                cloud: true
            }).catch(() => {});

            activeDownloads.delete(id);
            removeDownloadState(id);
            removeMediaRequest(url);

            setTimeout(processSaveQueue, 1000);
            return;
        } catch (error) {
            console.error("GDrive upload failed, falling back to local download:", error);
        }
    }

    const hiddenSuccess = await triggerHiddenDownload(id, filename);
    if (hiddenSuccess) {
        activeDownloads.delete(id);
        removeDownloadState(id);
        removeMediaRequest(url);
        browser.runtime.sendMessage({ action: 'downloadComplete', id: id, url: url }).catch(() => {});

        setTimeout(processSaveQueue, 1000);
        return;
    }

    const isAndroid = /Android/i.test(navigator.userAgent);
    const tab = await browser.tabs.create({
        url: browser.runtime.getURL(`download.html?id=${id}&url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`),
        active: isAndroid
    });
    activeBridgeTabId = tab.id;
}

browser.tabs.onRemoved.addListener((tabId) => {
    if (downloadTabs.has(tabId)) {
        const dlIds = downloadTabs.get(tabId);
        if (dlIds instanceof Set) {
            for (const dlId of dlIds) {
                cleanupDownload(dlId);
            }
        } else if (dlIds) {
            cleanupDownload(dlIds);
        }
        downloadTabs.delete(tabId);
    }

    if (tabId === activeBridgeTabId) {
        activeBridgeTabId = null;
        setTimeout(processSaveQueue, 1000);
    }
});

async function handleParallelFetchDownload(url, filename, total, connections, baseOptions, downloadId, providedContentType = null, startOffset = 0, isManualResume = false, providedMediaType = null) {
    total = parseInt(total) || 0;
    startOffset = parseInt(startOffset) || 0;
    connections = parseInt(connections) || 1;
    
    const existing = activeDownloads.get(downloadId);
    if (existing && existing.isPaused) return;

    if (activeDownloads.has(downloadId)) {
        const existingItem = activeDownloads.get(downloadId);
        if (existingItem.lastUploadPromise) {
            await existingItem.lastUploadPromise.catch(() => {});
        }
    }

    const abortController = new AbortController();
    baseOptions.signal = abortController.signal;

    try {
        const cleanOptions = { ...baseOptions };
        delete cleanOptions.signal;

        const currentItem = activeDownloads.get(downloadId);
        if (currentItem) {
            currentItem.loaded = startOffset;
            currentItem.total = total;
            currentItem.abortController = abortController;
            currentItem.isParallel = true;
            currentItem.isPaused = false;
        } else {
            activeDownloads.set(downloadId, {
                loaded: startOffset,
                total: total,
                abortController: abortController,
                url: url,
                filename: filename,
                originalRequest: cleanOptions,
                isParallel: true,
                isManualResume: isManualResume,
                isPaused: false,
                mediaType: providedMediaType || getMediaType(url, providedContentType)
            });
        }
        await saveDownloadState(downloadId, activeDownloads.get(downloadId));
        const remainingSize = total - startOffset;
        const partSize = Math.ceil(remainingSize / connections);
        const CHUNK_SIZE = 1024 * 1024; 
        let totalLoaded = startOffset;
        let lastReportTime = 0;
        const totalChunks = Math.ceil(total / CHUNK_SIZE);
        let savedChunks = Math.floor(startOffset / CHUNK_SIZE);

        const partPromises = [];

        for (let i = 0; i < connections; i++) {
            const partStart = startOffset + (i * partSize);
            const partEnd = Math.min(startOffset + ((i + 1) * partSize) - 1, total - 1);
            if (partStart >= total) break;

            partPromises.push((async (pIdx, pStart, pEnd) => {
                let currentPos = pStart;
                let retries = 0;
                const maxRetries = 5;

                while (currentPos <= pEnd) {
                    const itemCheck = activeDownloads.get(downloadId);
                    if (!itemCheck || itemCheck.isPaused) {
                        break;
                    }

                    try {
                        const partOptions = {
                            ...baseOptions,
                            headers: {
                                ...baseOptions.headers,
                                'Range': `bytes=${currentPos}-${pEnd}`
                            }
                        };

                        const response = await fetch(url, partOptions);
                        if (!response.ok && response.status !== 206) {
                            throw new Error(`Part ${pIdx} failed with status ${response.status}`);
                        }

                        const reader = response.body.getReader();
                        let currentBuffer = [];
                        let currentBufferSize = 0;

                        async function flushPartBuffer() {
                            if (currentBuffer.length === 0) return;
                            
                            const blob = new Blob(currentBuffer);

                            await storeChunkInCache(downloadId, currentPos - currentBufferSize, blob);
                            savedChunks++;

                            currentBuffer = [];
                            currentBufferSize = 0;
                            saveDownloadState(downloadId, activeDownloads.get(downloadId));
                        }

                        while (true) {
                            let readResult;
                            try {
                                readResult = await reader.read();
                            } catch (readError) {
                                await flushPartBuffer();
                                throw readError;
                            }

                            const { done, value } = readResult;
                            if (done) break;

                            const loopItemCheck = activeDownloads.get(downloadId);
                            if (!loopItemCheck || loopItemCheck.isPaused) {
                                reader.cancel();
                                break;
                            }

                            currentBuffer.push(value);
                            currentBufferSize += value.length;
                            currentPos += value.length;
                            totalLoaded += value.length;

                            const currentItem = activeDownloads.get(downloadId);
                            if (currentItem) {
                                currentItem.loaded = totalLoaded;
                            }

                            const now = Date.now();
                            if (now - lastReportTime > 200) {
                                lastReportTime = now;
                                browser.runtime.sendMessage({
                                    action: 'downloadProgress',
                                    id: downloadId,
                                    url: url,
                                    loaded: parseInt(totalLoaded) || 0,
                                    total: parseInt(total) || 0,
                                    isParallel: true,
                                    finishedParts: savedChunks,
                                    totalParts: totalChunks
                                }).catch(() => {});
                            }

                            if (currentBufferSize >= CHUNK_SIZE) {
                                await flushPartBuffer();
                            }
                        }
                        await flushPartBuffer();
                        break;
                    } catch (error) {
                        retries++;
                        console.warn(`Part ${pIdx} failed (attempt ${retries}/${maxRetries}) at position ${currentPos}:`, error);

                        const errorItemCheck = activeDownloads.get(downloadId);
                        if (!errorItemCheck || errorItemCheck.isPaused || retries >= maxRetries) {
                            throw error;
                        }

                        const waitTime = Math.min(1000 * Math.pow(2, retries), 8000);
                        await new Promise(r => setTimeout(r, waitTime));
                    }
                }
            })(i, partStart, partEnd));
        }

        await Promise.all(partPromises);

        browser.runtime.sendMessage({
            action: 'downloadProgress',
            id: downloadId,
            url: url,
            loaded: parseInt(total) || 0,
            total: parseInt(total) || 0,
            isParallel: true,
            finishedParts: totalChunks,
            totalParts: totalChunks
        }).catch(() => {});

        const finalFilename = filename || getFileName(url);
        const contentType = providedContentType || 'application/octet-stream';
        
        await storeInCache(downloadId, null, contentType);

        const settings = await browser.storage.local.get(['save-to-gdrive', 'gdrive-stream']);
        const isGdriveEnabled = settings['save-to-gdrive'] === '1';

        pendingSaveQueue.push({ 
            id: downloadId, 
            url, 
            filename: finalFilename,
            isStreamUploaded: false, // Parallel doesn't support stream upload yet
            cloud: isGdriveEnabled
        });
        processSaveQueue();

    } catch (error) {
        if (error.name === 'AbortError') {
            const item = activeDownloads.get(downloadId);
            if (item && item.abortController !== abortController) return;
            if (item && item.isPaused) return; 

            activeDownloads.delete(downloadId);
            cleanupDownload(downloadId);
            return;
        }
        console.error("Parallel download error:", error);
        browser.runtime.sendMessage({ 
            action: 'downloadError', 
            id: downloadId, 
            url: url, 
            error: error.message 
        }).catch(() => {});
        activeDownloads.delete(downloadId);
        cleanupDownload(downloadId);
    }
}

class CloudUploadController {
    constructor() {
        this.paused = false;
        this.cancelled = false;
        this.onResume = null;
        this.xhr = null;
    }

    pause() {
        this.paused = true;
        if (this.xhr) {
            this.xhr.abort();
        }
    }

    resume() {
        this.paused = false;
        if (this.onResume) {
            this.onResume();
        }
    }

    cancel() {
        this.cancelled = true;
        if (this.xhr) {
            this.xhr.abort();
        }
    }
}


async function reauthDropbox() {
    return new Promise((resolve, reject) => {
        try {
            const clientId = "gipboqpkook5oaj";
            let finalRedirectUri;
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
                finalRedirectUri = browser.identity.getRedirectURL();
            } else {
                const id = browser.runtime.id;
                if (id && id.includes('@')) {
                    finalRedirectUri = "https://" + encodeURIComponent(id) + ".extensions.allizom.org/";
                } else {
                    finalRedirectUri = "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
                }
            }
            const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;
            const authUrl = "https://www.dropbox.com/oauth2/authorize?client_id=" + clientId + "&response_type=token&redirect_uri=" + encodeURIComponent(finalRedirectUri);

            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                browser.identity.launchWebAuthFlow({ url: authUrl, interactive: false }).then(redirectUrl => {
                    if (redirectUrl) {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                        if (accessToken) {
                            browser.storage.local.set({ 'dropbox_token': accessToken }).then(() => resolve(accessToken));
                        } else {
                            reject(new Error("No access token found"));
                        }
                    } else reject(new Error("No redirect URL"));
                }).catch(e => reject(e));
            } else {
                let isResolved = false;
                let authTabId = null;
                const updatedListener = async (tabId, changeInfo, tab) => {
                    const urlString = changeInfo.url || tab.url;
                    if (urlString && urlString.includes(normalizedRedirectUri) && (urlString.includes('access_token=') || urlString.includes('error='))) {
                        if (!isResolved) {
                            isResolved = true;
                            browser.tabs.remove(tabId).catch(() => {});
                            cleanup();
                            const url = new URL(urlString);
                            const hashParams = new URLSearchParams(url.hash.substring(1));
                            const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                            if (accessToken) browser.storage.local.set({ 'dropbox_token': accessToken }).then(() => resolve(accessToken));
                            else reject(new Error("Failed to reauth Dropbox"));
                        }
                    }
                };
                const removedListener = (tabId) => {
                    if (authTabId && tabId === authTabId && !isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(new Error("Reauth tab closed"));
                    }
                };
                const cleanup = () => {
                    browser.tabs.onUpdated.removeListener(updatedListener);
                    browser.tabs.onRemoved.removeListener(removedListener);
                };
                browser.tabs.onUpdated.addListener(updatedListener);
                browser.tabs.onRemoved.addListener(removedListener);
                browser.tabs.create({ url: authUrl, active: false }).then(tab => { authTabId = tab.id; }).catch(e => {
                    if (!isResolved) { isResolved = true; cleanup(); reject(e); }
                });
            }
        } catch (e) { reject(e); }
    });
}

async function reauthGDrive() {
    return new Promise((resolve, reject) => {
        try {
            const clientId = "1042907477337-c8h27qniercjia05jqqafgvjao514n28.apps.googleusercontent.com";
            
            let finalRedirectUri;
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
                finalRedirectUri = browser.identity.getRedirectURL();
            } else {
                const id = browser.runtime.id;
                if (id && id.includes('@')) {
                    finalRedirectUri = `https://${encodeURIComponent(id)}.extensions.allizom.org/`;
                } else {
                    finalRedirectUri = "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
                }
            }

            const scope = encodeURIComponent("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email");
            const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;
            
            const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(finalRedirectUri)}&scope=${scope}&prompt=none`;
            
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                browser.identity.launchWebAuthFlow({
                    url: authUrl,
                    interactive: false
                }).then(async (redirectUrl) => {
                    if (redirectUrl) {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                        if (accessToken) {
                            await browser.storage.local.set({ 'gdrive_token': accessToken });
                            resolve(accessToken);
                        } else {
                            reject(new Error("No access token in redirect URL"));
                        }
                    } else {
                        reject(new Error("No redirect URL"));
                    }
                }).catch(e => {
                    reject(e);
                });
            } else {
                let isResolved = false;
                let authTabId = null;

                const updatedListener = async (tabId, changeInfo, tab) => {
                    const urlString = changeInfo.url || tab.url;
                    if (urlString && urlString.includes(normalizedRedirectUri) && (urlString.includes('access_token=') || urlString.includes('error='))) {
                        if (!isResolved) {
                            isResolved = true;
                            browser.tabs.remove(tabId).catch(() => {});
                            cleanup();
                            
                            const url = new URL(urlString);
                            const hashParams = new URLSearchParams(url.hash.substring(1));
                            const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                            
                            if (accessToken) {
                                await browser.storage.local.set({ 'gdrive_token': accessToken });
                                resolve(accessToken);
                            } else {
                                reject(new Error("Failed to reauth: " + (hashParams.get('error') || "No access token")));
                            }
                        }
                    }
                };

                const removedListener = (tabId) => {
                    if (authTabId && tabId === authTabId && !isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(new Error("Reauth tab closed"));
                    }
                };

                const cleanup = () => {
                    browser.tabs.onUpdated.removeListener(updatedListener);
                    browser.tabs.onRemoved.removeListener(removedListener);
                };

                browser.tabs.onUpdated.addListener(updatedListener);
                browser.tabs.onRemoved.addListener(removedListener);

                browser.tabs.create({ url: authUrl, active: false }).then(tab => {
                    authTabId = tab.id;
                }).catch(e => {
                    if (!isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(e);
                    }
                });
            }
        } catch (e) {
            reject(e);
        }
    });
}

function uploadToGDrive(blob, filename, onProgress, controller, isRetry = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('gdrive_token');
            if (!res.gdrive_token) {
                return reject(new Error(browser.i18n.getMessage("gdriveLoginRequired") || "Google Drive token not found. Please login in settings."));
            }
            const token = res.gdrive_token;

            const metadata = {
                name: filename,
                mimeType: blob.type || 'application/octet-stream'
            };

            const initXhr = new XMLHttpRequest();
            if (controller) controller.xhr = initXhr;
            initXhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable');
            initXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            initXhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
            initXhr.setRequestHeader('X-Upload-Content-Type', blob.type || 'application/octet-stream');
            initXhr.setRequestHeader('X-Upload-Content-Length', blob.size);

            initXhr.onload = () => {
                if (initXhr.status === 200 || initXhr.status === 201) {
                    const sessionUri = initXhr.getResponseHeader('Location');
                    if (sessionUri) {
                        uploadChunks(sessionUri, blob, onProgress, controller).then(resolve).catch(reject);
                    } else {
                        reject(new Error("Failed to get session URI for resumable upload"));
                    }
                } else if (initXhr.status === 401) {
                    if (!isRetry) {
                        reauthGDrive().then(() => {
                            uploadToGDrive(blob, filename, onProgress, controller, true).then(resolve).catch(reject);
                        }).catch(() => {
                            reject(new Error("Google Drive session expired. Please re-login in settings."));
                        });
                    } else {
                        reject(new Error("Google Drive session expired. Please re-login in settings."));
                    }
                } else {
                    reject(new Error("GDrive Init Error: " + initXhr.statusText));
                }
            };

            initXhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToGDrive(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                }
            };

            initXhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadToGDrive(blob, filename, onProgress, controller).then(resolve).catch(reject);
                    };
                } else {
                    reject(new Error("Network error during GDrive init"));
                }
            };
            initXhr.send(JSON.stringify(metadata));

        } catch (error) {
            reject(error);
        }
    });
}

function uploadChunks(sessionUri, blob, onProgress, controller) {
    return new Promise((resolve, reject) => {
        const chunkSize = 1024 * 1024; // 1MB chunks
        let offset = 0;

        const uploadNextChunk = (retries = 3) => {
            if (controller && controller.cancelled) {
                reject(new Error("Upload cancelled"));
                return;
            }

            if (controller && controller.paused) {
                controller.onResume = () => {
                    controller.onResume = null;
                    uploadNextChunk();
                };
                return;
            }

            const end = Math.min(offset + chunkSize, blob.size);
            const chunk = blob.slice(offset, end);
            const contentRange = `bytes ${offset}-${end - 1}/${blob.size}`;

            const xhr = new XMLHttpRequest();
            if (controller) controller.xhr = xhr;
            xhr.open('PUT', sessionUri);
            xhr.setRequestHeader('Content-Range', contentRange);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    const totalUploaded = offset + e.loaded;
                    const percent = Math.round((totalUploaded / blob.size) * 100);
                    onProgress(percent, totalUploaded, blob.size);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 308) {
                    offset = end;
                    uploadNextChunk();
                } else if (xhr.status === 200 || xhr.status === 201) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        resolve(xhr.responseText);
                    }
                } else if (xhr.status >= 500 && xhr.status < 600) {
                    if (retries > 0) {
                        console.warn(`GDrive Chunk Error: ${xhr.status}, retrying... (${retries} left)`);
                        setTimeout(() => uploadNextChunk(retries - 1), 2000);
                    } else {
                        reject(new Error("GDrive Chunk Error: " + xhr.status + " " + xhr.statusText));
                    }
                } else {
                    reject(new Error("GDrive Chunk Error: " + xhr.status + " " + xhr.statusText));
                }
            };

            xhr.onabort = () => {
                if (controller && controller.paused) {
                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadNextChunk();
                    };
                }
            };

            xhr.onerror = () => {
                if (controller && controller.cancelled) {
                    reject(new Error("Upload cancelled"));
                } else if (controller && controller.paused) {

                    controller.onResume = () => {
                        controller.onResume = null;
                        uploadNextChunk();
                    };
                } else {
                    if (retries > 0) {
                        console.warn(`Network error during GDrive chunk upload, retrying... (${retries} left)`);
                        setTimeout(() => uploadNextChunk(retries - 1), 2000);
                    } else {
                        reject(new Error("Network error during GDrive chunk upload"));
                    }
                }
            };
            xhr.send(chunk);
        };

        uploadNextChunk();
    });
}

async function startDropboxStreamUpload(filename) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            if (!res.dropbox_token) {
                return reject(new Error("Dropbox token not found. Please login in settings."));
            }
            const token = res.dropbox_token;

            const initXhr = new XMLHttpRequest();
            initXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/start');
            initXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            initXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            initXhr.setRequestHeader('Dropbox-API-Arg', JSON.stringify({ close: false }));

            initXhr.onload = () => {
                if (initXhr.status === 200 || initXhr.status === 201) {
                    try {
                        const response = JSON.parse(initXhr.responseText);
                        resolve(response.session_id);
                    } catch (e) {
                        reject(new Error("Failed to parse Dropbox session ID"));
                    }
                } else if (initXhr.status === 401) {
                    reauthDropbox().then(() => {
                        startDropboxStreamUpload(filename).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox Stream Init Error: " + initXhr.statusText));
                }
            };
            initXhr.onerror = () => reject(new Error("Network error during Dropbox stream init"));
            initXhr.send();
        } catch (e) {
            reject(e);
        }
    });
}

async function appendDropboxStream(sessionId, offset, chunk) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            const token = res.dropbox_token;
            if (!token) return reject(new Error("Dropbox token missing"));

            const appendXhr = new XMLHttpRequest();
            appendXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/append_v2');
            appendXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            appendXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            appendXhr.setRequestHeader('Dropbox-API-Arg', JSON.stringify({
                cursor: {
                    session_id: sessionId,
                    offset: offset
                },
                close: false
            }));

            appendXhr.onload = () => {
                if (appendXhr.status === 200 || appendXhr.status === 201) {
                    resolve();
                } else if (appendXhr.status === 401) {
                    reauthDropbox().then(() => {
                        appendDropboxStream(sessionId, offset, chunk).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox append error: " + appendXhr.statusText));
                }
            };
            appendXhr.onerror = () => reject(new Error("Network error during Dropbox append"));
            appendXhr.send(chunk);
        } catch (e) {
            reject(e);
        }
    });
}

async function finishDropboxStream(sessionId, offset, filename) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await browser.storage.local.get('dropbox_token');
            const token = res.dropbox_token;
            if (!token) return reject(new Error("Dropbox token missing"));

            const finishXhr = new XMLHttpRequest();
            finishXhr.open('POST', 'https://content.dropboxapi.com/2/files/upload_session/finish');
            finishXhr.setRequestHeader('Authorization', `Bearer ${token}`);
            finishXhr.setRequestHeader('Content-Type', 'application/octet-stream');
            const apiArgRaw = JSON.stringify({
                cursor: { session_id: sessionId, offset: offset },
                commit: {
                    path: "/" + filename.replace(/[/\\?%*:|"<>]/g, '-'),
                    mode: "add", autorename: true, mute: false
                }
            });
            const apiArg = apiArgRaw.replace(/[\u007f-\uffff]/g, function(c) { 
                return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
            });
            finishXhr.setRequestHeader('Dropbox-API-Arg', apiArg);

            finishXhr.onload = () => {
                if (finishXhr.status === 200 || finishXhr.status === 201) {
                    resolve();
                } else if (finishXhr.status === 401) {
                    reauthDropbox().then(() => {
                        finishDropboxStream(sessionId, offset, filename).then(resolve).catch(reject);
                    }).catch(reject);
                } else {
                    reject(new Error("Dropbox finish error: " + finishXhr.statusText));
                }
            };
            finishXhr.onerror = () => reject(new Error("Network error during Dropbox finish"));
            finishXhr.send();
        } catch (e) {
            reject(e);
        }
    });
}

async function startGDriveStreamUpload(filename, totalSize, contentType, isRetry = false) {
    const res = await browser.storage.local.get('gdrive_token');
    if (!res.gdrive_token) throw new Error("Google Drive token not found");
    const token = res.gdrive_token;

    const metadata = {
        name: filename,
        mimeType: contentType || 'application/octet-stream'
    };

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': contentType || 'application/octet-stream',
            'X-Upload-Content-Length': totalSize || '*'
        },
        body: JSON.stringify(metadata)
    });

    if (response.status === 401 && !isRetry) {
        try {
            await reauthGDrive();
            return await startGDriveStreamUpload(filename, totalSize, contentType, true);
        } catch (e) {
            throw new Error("GDrive Session Init Error (401): " + response.statusText);
        }
    } else if (response.status !== 200 && response.status !== 201) {
        throw new Error("GDrive Session Init Error: " + response.statusText);
    }

    return response.headers.get('Location');
}

async function uploadStreamChunk(sessionUri, chunk, offset, totalSize) {
    const total = (totalSize !== undefined && totalSize !== null) ? totalSize : '*';
    let contentRange;
    if (chunk && chunk.byteLength > 0) {
        const end = offset + chunk.byteLength;
        contentRange = `bytes ${offset}-${end - 1}/${total}`;
    } else {

        contentRange = `bytes */${total}`;
        if (total === '*') return; // Cannot finalize with unknown size and no data
        chunk = new Uint8Array(0);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for each chunk

    try {
        const response = await fetch(sessionUri, {
            method: 'PUT',
            headers: {
                'Content-Range': contentRange
            },
            body: chunk,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status !== 308 && response.status !== 200 && response.status !== 201) {
            throw new Error("GDrive Chunk Upload Error: " + response.status);
        }

        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}
async function handleFetchDownload(url, filename, originalRequest = null, providedId = null, isResuming = false, isManualResume = false, providedResumeOffset = null, providedMediaType = null, providedDropboxSessionId = null) {
    providedResumeOffset = parseInt(providedResumeOffset) || 0;
    const settings = await browser.storage.local.get(['speed-boost', 'speed-boost-resume', 'connections', 'save-to-gdrive', 'gdrive-stream', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token', 'fetch-notification']);
    const speedBoostEnabled = settings['speed-boost'] === '1';
    const speedBoostResumeEnabled = settings['speed-boost-resume'] === '1';
    const connections = parseInt(settings['connections'] || '4', 10);
    const gdriveEnabled = settings['save-to-gdrive'] === '1';
    const gdriveStreamEnabled = settings['save-to-gdrive'] === '1' && settings['gdrive-stream'] === '1' && settings['gdrive_token'] && !isResuming;
    const dropboxStreamEnabled = settings['save-to-dropbox'] === '1' && settings['dropbox-stream'] === '1' && settings['dropbox_token']; // Allowed during resume!


    const abortController = new AbortController();
    const downloadId = providedId || ('dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));

    const showNotif = settings['fetch-notification'] !== '0';
    if (showNotif) {
        try {
            browser.notifications.create(downloadId, {
                type: "basic",
                iconUrl: browser.runtime.getURL("icons/icon.png"),
                title: (browser.i18n.getMessage("downloadingTitle") || "Downloading..."),
                message: filename
            });
        } catch (err) {
            console.warn("Notifications API error:", err);
        }
    }

    if (!activeDownloads.has(downloadId)) {
        activeDownloads.set(downloadId, { 
            loaded: providedResumeOffset || 0, 
            total: 0, 
            abortController: abortController, 
            url: url,
            filename: filename,
            isParallel: false,
            isManualResume: isManualResume,
            isPaused: false,
            mediaType: providedMediaType || getMediaType(url, []),
            dropboxSessionId: providedDropboxSessionId
        });
    } else {
        const item = activeDownloads.get(downloadId);
        item.abortController = abortController;
        item.isPaused = false;
        if (providedDropboxSessionId) item.dropboxSessionId = providedDropboxSessionId;
    }

    let resumeOffset = providedResumeOffset || 0;
    let isByteOffsetMode = resumeOffset > 10000;
    let nextChunkIndex = isByteOffsetMode ? resumeOffset : Math.floor(resumeOffset / (1024 * 1024));

    if (isResuming) {
        try {
            const db = await getDB();
            const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
            const store = tx.objectStore(CHUNK_STORE_NAME);
            const range = IDBKeyRange.bound([downloadId, 0], [downloadId, Infinity]);
            
            const cursorRequest = store.openCursor(range, "prev");
            const lastChunk = await new Promise((resolve) => {
                cursorRequest.onsuccess = (e) => resolve(e.target.result ? e.target.result.value : null);
                cursorRequest.onerror = () => resolve(null);
            });

            if (lastChunk) {
                const dbIsByteOffsetMode = lastChunk.chunkIndex > 10000; 

                const dbResumeOffset = await new Promise((resolve) => {
                    let sum = 0;
                    const countTx = db.transaction([CHUNK_STORE_NAME], "readonly");
                    const countStore = countTx.objectStore(CHUNK_STORE_NAME);
                    const countReq = countStore.openCursor(range);
                    countReq.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            sum += cursor.value.data.length;
                            cursor.continue();
                        } else resolve(sum);
                    };
                    countReq.onerror = () => resolve(0);
                });


                if (dbResumeOffset > resumeOffset) {
                    resumeOffset = dbResumeOffset;
                    isByteOffsetMode = dbIsByteOffsetMode;
                    if (isByteOffsetMode) {
                        nextChunkIndex = resumeOffset; 
                    } else {
                        nextChunkIndex = lastChunk.chunkIndex + 1;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to calculate resume offset from DB:", e);
        }
    } else {
        isByteOffsetMode = true; 
    }

    try {
        const fetchOptions = {
            method: (originalRequest && originalRequest.method) ? originalRequest.method : 'GET',
            headers: (originalRequest && originalRequest.headers && !Array.isArray(originalRequest.headers)) ? { ...originalRequest.headers } : {},
            credentials: (originalRequest && originalRequest.credentials) ? originalRequest.credentials : 'include',
            signal: abortController.signal
        };

        if (resumeOffset > 0) {
            fetchOptions.headers['Range'] = `bytes=${resumeOffset}-`;
        } else if (speedBoostEnabled && connections > 1 && !gdriveStreamEnabled && !dropboxStreamEnabled) {
            fetchOptions.headers['Range'] = `bytes=0-`;
        }

        if (originalRequest && originalRequest.requestHeaders && Array.isArray(originalRequest.requestHeaders)) {
            originalRequest.requestHeaders.forEach(h => {
                const name = h.name.toLowerCase();

                if (name !== 'cookie' && name !== 'referer' && name !== 'range' && name !== 'host') {
                    fetchOptions.headers[h.name] = h.value;
                }
            });
        }

        const storedHeaders = urlToHeaderMap.get(url);
        if (storedHeaders) {
            for (const [name, value] of Object.entries(storedHeaders)) {
                if (name === 'cookie') {
                    fetchOptions.headers['Cookie'] = value;
                } else if (name === 'referer') {
                    fetchOptions.referrer = value;
                    fetchOptions.headers['Referer'] = value;
                } else if (name !== 'host' && name !== 'content-length') {
                    fetchOptions.headers[name] = value;
                }
            }

            if (storedHeaders.referer && !fetchOptions.headers['Origin']) {
                try {
                    const refUrl = new URL(storedHeaders.referer);
                    if (refUrl.protocol.startsWith('http')) {
                        fetchOptions.headers['Origin'] = refUrl.origin;
                    }
                } catch (e) {}
            }
        }

        const manualReferer = originalRequest?.requestHeaders?.find(h => h.name.toLowerCase() === 'referer')?.value;
        if (manualReferer) {
            fetchOptions.referrer = manualReferer;
            fetchOptions.headers['Referer'] = manualReferer;
            if (!fetchOptions.headers['Origin']) {
                try {
                    const refUrl = new URL(manualReferer);
                    if (refUrl.protocol.startsWith('http')) fetchOptions.headers['Origin'] = refUrl.origin;
                } catch(e) {}
            }
        }

        if (originalRequest && originalRequest.method !== 'GET' && originalRequest.requestBody) {
            if (originalRequest.requestBody.type === 'formData') {
                const formData = new FormData();
                for (const key in originalRequest.requestBody.data) {
                    originalRequest.requestBody.data[key].forEach(val => formData.append(key, val));
                }
                fetchOptions.body = formData;
            } else if (originalRequest.requestBody.type === 'base64') {
                const bin = atob(originalRequest.requestBody.data);
                const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                fetchOptions.body = u;
            }
        }

        if (activeDownloads.has(downloadId)) {
            const current = activeDownloads.get(downloadId);
            current.abortController = abortController;
            current.isManualResume = isManualResume;
            current.isPaused = false;
        }

        const response = await fetch(url, fetchOptions);

        const itemBeforeProceed = activeDownloads.get(downloadId);
        if (itemBeforeProceed && itemBeforeProceed.isPaused) {
            if (response.body && response.body.cancel) response.body.cancel();
            return;
        }

        if (!response.ok && response.status !== 206) throw new Error(browser.i18n.getMessage("serverErrorStatus", [response.status.toString()]) || ("Server error: " + response.status));

        let currentResumeOffset = resumeOffset;
        let activeChunkIndex = nextChunkIndex;
        let activeByteOffsetMode = isByteOffsetMode;

        if (resumeOffset > 0 && response.status !== 206) {
            console.warn("Server ignored Range header, restarting download from byte 0");
            currentResumeOffset = 0;
            activeChunkIndex = 0;
            activeByteOffsetMode = true; 
        }

        const contentLength = response.headers.get('content-length');
        let total = (contentLength ? parseInt(contentLength, 10) : 0) + currentResumeOffset;

        const contentRange = response.headers.get('content-range');
        if (contentRange) {
            const match = contentRange.match(/\/(\d+)/);
            if (match) {
                total = parseInt(match[1], 10);
            }
        }

        const acceptRanges = response.headers.get('accept-ranges');
        const supportsRanges = acceptRanges === 'bytes' || response.status === 206;
        const contentType = response.headers.get('content-type');

        const canUseSpeedBoost = speedBoostEnabled && supportsRanges && total > 2 * 1024 * 1024 && connections > 1 && !gdriveStreamEnabled && !dropboxStreamEnabled;

        const speedBoostAllowed = isManualResume ? speedBoostResumeEnabled : true;

        if (canUseSpeedBoost && speedBoostAllowed) {
            
            const itemBeforeParallel = activeDownloads.get(downloadId);
            if (itemBeforeParallel && itemBeforeParallel.isPaused) {
                if (response.body && response.body.cancel) response.body.cancel();
                return;
            }

            if (response.body && response.body.cancel) {
                response.body.cancel();
            } else {
                abortController.abort();
            }

            const parallelOptions = { ...fetchOptions };
            delete parallelOptions.signal;

            return handleParallelFetchDownload(url, filename, total, connections, parallelOptions, downloadId, contentType, currentResumeOffset, isManualResume, providedMediaType);
        }

        const cleanOriginalRequest = { ...fetchOptions };
        delete cleanOriginalRequest.signal;

        const existingItem = activeDownloads.get(downloadId);
        if (existingItem) {
            existingItem.loaded = currentResumeOffset;
            existingItem.total = total;
            existingItem.abortController = abortController;
            existingItem.isParallel = false;
            existingItem.isPaused = false;
            existingItem.chunkIndex = activeChunkIndex;
        } else {
            activeDownloads.set(downloadId, { 
                loaded: currentResumeOffset, 
                total: total, 
                abortController: abortController, 
                url: url,
                filename: filename,
                originalRequest: cleanOriginalRequest,
                isParallel: false,
                isManualResume: isManualResume,
                isPaused: false,
                chunkIndex: activeChunkIndex,
                mediaType: providedMediaType || getMediaType(url, contentType),
                dropboxSessionId: dropboxSessionId
            });
        }
        await saveDownloadState(downloadId, activeDownloads.get(downloadId));

        let gdriveSessionUri = null;
        let dropboxSessionId = providedDropboxSessionId || null;
        if (dropboxStreamEnabled && !dropboxSessionId) {
            try {
                dropboxSessionId = await startDropboxStreamUpload(filename || getFileName(url));
                if (activeDownloads.has(downloadId)) activeDownloads.get(downloadId).dropboxSessionId = dropboxSessionId;
            } catch (e) {
                console.error("Failed to start Dropbox stream upload:", e);
            }
        }
        if (gdriveStreamEnabled) {
            try {
                gdriveSessionUri = await startGDriveStreamUpload(filename || getFileName(url), total, contentType);
            } catch (e) {
                console.error("Failed to start GDrive stream upload:", e);

            }
        }

        const infoBeforeLoop = activeDownloads.get(downloadId);
        const reader = response.body.getReader();
        let loaded = currentResumeOffset;
        let lastReportTime = 0;

        const writeQueue = [];
        const MAX_WRITE_QUEUE = 10;
        let lastUploadPromise = Promise.resolve();
        if (infoBeforeLoop) infoBeforeLoop.lastUploadPromise = lastUploadPromise;

        let currentBuffer = [];
        let currentBufferSize = 0;
        const GDRIVE_CHUNK_UNIT = 256 * 1024; // GDrive requirement
        const BUFFER_THRESHOLD = 1024 * 1024; // 1MB buffer

        async function flushBuffer(isFinal = false) {
            if (currentBufferSize === 0 && (!isFinal || !gdriveSessionUri)) return;

            let dataToUpload = null;
            let uploadSize = 0;

            const fullData = new Uint8Array(currentBufferSize);
            let pos = 0;
            for (const b of currentBuffer) {
                fullData.set(b, pos);
                pos += b.length;
            }

            if (isFinal || !gdriveSessionUri) {
                dataToUpload = fullData;
                uploadSize = currentBufferSize;
                currentBuffer = [];
                currentBufferSize = 0;
            } else {

                uploadSize = Math.floor(currentBufferSize / GDRIVE_CHUNK_UNIT) * GDRIVE_CHUNK_UNIT;
                if (uploadSize === 0) return; // Not enough data yet

                dataToUpload = fullData.slice(0, uploadSize);
                const remainder = fullData.slice(uploadSize);
                currentBuffer = [remainder];
                currentBufferSize = remainder.length;
            }

            let usedIndex;
            if (activeByteOffsetMode) {
                usedIndex = loaded - (fullData.length - (fullData.length - uploadSize)); // Corrected below

            }
            

            const byteOffset = loaded - currentBufferSize - uploadSize;
            
            if (dataToUpload.length > 0) {
                const writePromise = storeChunkInCache(downloadId, activeByteOffsetMode ? byteOffset : activeChunkIndex++, dataToUpload);
                writeQueue.push(writePromise);
            }

            if (dropboxSessionId && dataToUpload.length > 0) {
                const currentDbxSessionId = dropboxSessionId;
                const chunkData = dataToUpload;
                const currentOffset = byteOffset;
                
                lastUploadPromise = lastUploadPromise.then(async () => {
                    if (!dropboxSessionId) return;
                    
                    let retries = 3;
                    while (retries > 0) {
                        try {
                            await appendDropboxStream(currentDbxSessionId, currentOffset, chunkData);
                            return;
                        } catch (e) {
                            retries--;
                            console.warn(`Dropbox chunk upload retry (${3-retries}):`, e);
                            if (retries === 0) {
                                console.error("Dropbox stream upload failed after retries.");
                                dropboxSessionId = null;
                            } else {
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    }
                });
                writeQueue.push(lastUploadPromise);
                if (activeDownloads.has(downloadId)) activeDownloads.get(downloadId).lastUploadPromise = lastUploadPromise;
            }

            if (gdriveSessionUri && (dataToUpload.length > 0 || isFinal)) {
                const currentSessionUri = gdriveSessionUri;
                const chunkData = dataToUpload;
                const currentOffset = byteOffset;
                const currentTotal = isFinal ? loaded : total;
                
                lastUploadPromise = lastUploadPromise.then(async () => {
                    if (!gdriveSessionUri) return;
                    
                    let retries = 3;
                    while (retries > 0) {
                        try {
                            await uploadStreamChunk(currentSessionUri, chunkData, currentOffset, currentTotal);
                            return;
                        } catch (e) {
                            retries--;
                            console.warn(`GDrive chunk upload retry (${3-retries}):`, e);
                            if (retries === 0) {
                                console.error("GDrive stream upload failed after retries.");
                                gdriveSessionUri = null;
                            } else {
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    }
                });
                writeQueue.push(lastUploadPromise);
                if (activeDownloads.has(downloadId)) activeDownloads.get(downloadId).lastUploadPromise = lastUploadPromise;
            }

            while (writeQueue.length >= MAX_WRITE_QUEUE) {
                await writeQueue.shift();
            }
            saveDownloadState(downloadId, activeDownloads.get(downloadId));
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const currentItem = activeDownloads.get(downloadId);
            if (!currentItem || currentItem.isPaused) {
                reader.cancel();
                break;
            }
            currentItem.loaded = loaded;

            currentBuffer.push(value);
            currentBufferSize += value.length;
            loaded += value.length;

            const now = Date.now();
            if (now - lastReportTime > 100) {
                lastReportTime = now;
                browser.runtime.sendMessage({
                    action: 'downloadProgress',
                    id: downloadId,
                    url: url,
                    loaded: parseInt(loaded) || 0,
                    total: parseInt(total) || 0,
                    isParallel: false,
                    isPaused: false,
                    status: (gdriveSessionUri || dropboxSessionId) ? 'uploading' : 'downloading'
                }).catch(() => {});
            }

            if (currentBufferSize >= BUFFER_THRESHOLD) {
                await flushBuffer();
            }
        }


        if (total <= 0) total = loaded;
        
        await flushBuffer(true);

        await Promise.all(writeQueue);


        
        if (dropboxSessionId) {
            try {
                await finishDropboxStream(dropboxSessionId, loaded, filename || getFileName(url));
                const currentItem = activeDownloads.get(downloadId);
                if (currentItem) currentItem.isStreamUploaded = true;
            } catch (e) {
                console.error("Dropbox finish failed", e);
            }
        }
        if (gdriveSessionUri) {
            const currentItem = activeDownloads.get(downloadId);
            if (currentItem) currentItem.isStreamUploaded = true;
        }

        browser.runtime.sendMessage({
            action: 'downloadProgress',
            id: downloadId,
            url: url,
            loaded: parseInt(loaded) || 0,
            total: parseInt(total) || 0,
            isParallel: false,
            percent: 100,
            status: ((gdriveSessionUri || dropboxSessionId) && activeDownloads.get(downloadId)?.isStreamUploaded) ? 'uploading' : 'downloading'
        }).catch(() => {});

        const currentItem = activeDownloads.get(downloadId);
        if (currentItem) {
            currentItem.status = 'complete';
            currentItem.percent = 100;
        }

        const finalFilename = filename || getFileName(url);
        const contentTypeToStore = contentType || 'application/octet-stream';

        await storeInCache(downloadId, null, contentTypeToStore);

        const currentItemAfterCache = activeDownloads.get(downloadId);
        const gdriveFallBack = (settings['save-to-gdrive'] === '1' && !gdriveStreamEnabled) || (settings['save-to-dropbox'] === '1' && !dropboxStreamEnabled);

        pendingSaveQueue.push({
            id: downloadId,
            url,
            filename: finalFilename,
            isStreamUploaded: currentItemAfterCache ? !!currentItemAfterCache.isStreamUploaded : false,
            cloud: gdriveFallBack
        });
        processSaveQueue();

        if (showNotif) {
            try {
                browser.notifications.clear(downloadId);
                const completeId = downloadId + '_complete';
                browser.notifications.create(completeId, {
                    type: "basic",
                    iconUrl: browser.runtime.getURL("icons/icon.png"),
                    title: browser.i18n.getMessage("downloadCompleteTitle") || "Download completed",
                    message: finalFilename
                });
                setTimeout(() => {
                    try { browser.notifications.clear(completeId); } catch (e) {}
                }, 5000);
            } catch (err) {
                console.warn("Notifications API error:", err);
            }
        }
    } catch (error) {
        if (showNotif) {
            try {
                browser.notifications.clear(downloadId);
                if (error.name !== 'AbortError' && error.message !== 'Cancelled') {
                    browser.notifications.create(downloadId + '_error', {
                        type: "basic",
                        iconUrl: browser.runtime.getURL("icons/icon.png"),
                        title: "Download failed",
                        message: error.message
                    });
                }
            } catch (err) {
                console.warn("Notifications API error:", err);
            }
        }

        if (error.name === 'AbortError') {
            const item = activeDownloads.get(downloadId);
            if (item && item.isPaused) return; 
            
            activeDownloads.delete(downloadId);
            browser.runtime.sendMessage({ action: 'downloadError', url: url, error: 'USER_CANCELED' }).catch(() => {});
            removeDownloadState(downloadId);
            return;
        }

        console.error("Background fetch download failed:", error);
        browser.runtime.sendMessage({ action: 'downloadError', url: url, error: error.message }).catch(() => {});

        activeDownloads.delete(downloadId);
        removeDownloadState(downloadId);
    }
}

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

browser.storage.local.get('open-preference', function (result) {
    if (result['open-preference'] === 'popup' || result['open-preference'] === undefined) {
        browser.action.setPopup({ popup: 'popup.html' });
    } else {
        browser.action.setPopup({ popup: '' });
    }
});

browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'clearStorage') {

        const activeUrls = new Set();
        for (const [key, value] of activeDownloads) {
            if (value.url) activeUrls.add(value.url);
        }

        browser.storage.session.get(null, function (items) {
            const keysToRemove = [];
            for (const url in items) {
                if (!activeUrls.has(url)) {
                    keysToRemove.push(url);
                }
            }
            if (keysToRemove.length > 0) {
                browser.storage.session.remove(keysToRemove);
            }
        });

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
            browser.storage.session.remove(message.url);
        }
    }
});

browser.action.onClicked.addListener((tab) => {
    browser.storage.local.get('open-preference', function (result) {
        if (result['open-preference'] !== 'window') {

            browser.tabs.create({
                url: browser.runtime.getURL(`popup.html?mode=tab`),
            });
        } else {

            browser.windows.create({
                url: browser.runtime.getURL(`popup.html?mode=window`),
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

let cacheListener = null;
let mediaCacheEnabled = false;

function detachCacheListener() {
    if (!cacheListener) return;
    try {
        browser.webRequest.onBeforeRequest.removeListener(cacheListener);
    } catch (e) {  }
    cacheListener = null;
    console.debug("Cache listener detached.");
}

function attachCacheListener() {
    if (cacheListener) return;

    if (!browser.webRequest || !browser.webRequest.filterResponseData) {
        
        return;
    }

    const requestBuffers = new Map();

    cacheListener = (details) => {
        try {

            if (details.incognito) return;
            const mType = getMediaType(details.url);
            if (isMediaTypeDisabled(mType, cachedSettings)) return;

            if (!detectionRegex.test(details.url)) return;

            let filter;
            try {
                filter = browser.webRequest.filterResponseData(details.requestId);
            } catch (e) {
                console.warn("filterResponseData failed for requestId", details.requestId, e);
                return;
            }

            const downloadId = details.url;
            requestBuffers.set(details.requestId, { chunks: [], size: 0, totalCached: 0, index: 0 });

            const flushBuffer = async (reqId) => {
                const state = requestBuffers.get(reqId);
                if (!state || state.chunks.length === 0) return;

                const blob = new Blob(state.chunks);
                const currentIndex = state.index++;
                state.chunks = [];
                state.size = 0;

                await storeChunkInCache(downloadId, currentIndex, blob);
            };

            filter.ondata = (event) => {
                try {

                    filter.write(event.data);

                    const state = requestBuffers.get(details.requestId);
                    if (state) {
                        state.chunks.push(event.data);
                        state.size += event.data.byteLength;
                        state.totalCached += event.data.byteLength;

                        let currentThreshold = 1024 * 1024; // 1MB
                        if (state.totalCached > 50 * 1024 * 1024) {
                            currentThreshold = 4 * 1024 * 1024; // 4MB
                        } else if (state.totalCached > 10 * 1024 * 1024) {
                            currentThreshold = 2 * 1024 * 1024; // 2MB
                        }

                        if (state.size >= currentThreshold) {
                            flushBuffer(details.requestId).catch(err => console.error("Failed to flush buffer:", err));
                        }
                    }
                } catch (e) {
                    console.error("Error writing chunk back to filter:", e);
                }
            };
            filter.onstop = async () => {
                try {
                    await flushBuffer(details.requestId);
                    requestBuffers.delete(details.requestId);
                    filter.disconnect();

                    await storeInCache(downloadId, null, 'application/octet-stream');
                } catch (e) {
                    console.error("Failed to cache response body for", details.url, e);
                }
            };
            filter.onerror = (err) => {
                try { filter.disconnect(); } catch (e) {}
                console.error("filter error:", err);
            };
        } catch (e) {
            console.error("Error in cache listener:", e);
        }
    };

    browser.webRequest.onBeforeRequest.addListener(
        cacheListener,
        { urls: ["<all_urls>"],  },
        []
    );

    console.debug("Cache listener attached.");
}

async function initCacheState() {
    try {
        const res = await browser.storage.local.get('media-cache');
        const enabled = !!isFlagEnabled(res['media-cache']);
        mediaCacheEnabled = enabled;
        if (mediaCacheEnabled) {
            attachCacheListener();
        } else {
            detachCacheListener();
        }
    } catch (e) {
        console.error("Failed to read media-cache setting:", e);

        mediaCacheEnabled = false;
        detachCacheListener();
    }
}

browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    getSettings(function(newSettings) {
        cachedSettings = newSettings;
        if (newSettings.ignoreDisabledTypes) {
            browser.storage.session.get(null, (items) => {
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
                    browser.storage.session.remove(keysToRemove);
                }
            });
        }
    });

    if (Object.prototype.hasOwnProperty.call(changes, 'media-cache')) {
        const newEnabled = !!isFlagEnabled(changes['media-cache'].newValue);
        if (newEnabled !== mediaCacheEnabled) {
            mediaCacheEnabled = newEnabled;
            if (mediaCacheEnabled) {
                attachCacheListener();
            } else {
                detachCacheListener();
            }
        }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'open-preference')) {
        const newVal = changes['open-preference'].newValue;
        if (newVal === 'popup') {
            browser.action.setPopup({ popup: 'popup.html' });
        } else {
            browser.action.setPopup({ popup: '' });
        }
    }
});

initCacheState();
restoreActiveDownloadsFromSession();

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

function getExtFromMime(mimeType) {
    if (!mimeType) return "";
    const mimeLower = mimeType.toLowerCase().trim();
    
    if (mimeLower.includes("video/mp4")) return ".mp4";
    if (mimeLower.includes("video/webm")) return ".webm";
    if (mimeLower.includes("video/ogg")) return ".ogg";
    if (mimeLower.includes("video/quicktime")) return ".mov";
    if (mimeLower.includes("video/x-matroska")) return ".mkv";
    if (mimeLower.includes("video/x-msvideo")) return ".avi";
    if (mimeLower.includes("video/x-flv")) return ".flv";
    if (mimeLower.includes("video/3gpp")) return ".3gp";
    
    if (mimeLower.includes("audio/mpeg") || mimeLower.includes("audio/mp3")) return ".mp3";
    if (mimeLower.includes("audio/wav") || mimeLower.includes("audio/x-wav")) return ".wav";
    if (mimeLower.includes("audio/webm")) return ".webm";
    if (mimeLower.includes("audio/ogg") || mimeLower.includes("audio/opus")) return ".ogg";
    if (mimeLower.includes("audio/aac")) return ".aac";
    if (mimeLower.includes("audio/flac")) return ".flac";
    if (mimeLower.includes("audio/x-m4a") || mimeLower.includes("audio/m4a") || mimeLower.includes("audio/mp4")) return ".m4a";
    
    if (mimeLower.includes("image/jpeg") || mimeLower.includes("image/jpg")) return ".jpg";
    if (mimeLower.includes("image/png")) return ".png";
    if (mimeLower.includes("image/gif")) return ".gif";
    if (mimeLower.includes("image/webp")) return ".webp";
    if (mimeLower.includes("image/svg+xml")) return ".svg";
    
    if (mimeLower.includes("application/zip")) return ".zip";
    if (mimeLower.includes("application/pdf")) return ".pdf";
    if (mimeLower.includes("text/vtt")) return ".vtt";
    if (mimeLower.includes("application/x-subrip")) return ".srt";
    
    if (mimeLower.startsWith("video/")) {
        const sub = mimeLower.substring(6);
        if (/^[a-z0-9]+$/.test(sub)) return "." + sub;
    }
    if (mimeLower.startsWith("audio/")) {
        const sub = mimeLower.substring(6);
        if (/^[a-z0-9]+$/.test(sub)) {
            if (sub === "mpeg") return ".mp3";
            return "." + sub;
        }
    }
    if (mimeLower.startsWith("image/")) {
        const sub = mimeLower.substring(6);
        if (/^[a-z0-9]+$/.test(sub)) return "." + sub;
    }

    return "";
}

function ensureFileExtension(filename, mimeType) {
    if (!filename) return filename;
    filename = filename.trim();
    
    const hasExtension = /\.[a-zA-Z0-9]{1,5}$/.test(filename);
    if (hasExtension) {
        return filename;
    }
    
    const ext = getExtFromMime(mimeType);
    if (ext) {
        return filename + ext;
    }
    
    return filename;
}
importScripts('chrome_audio_jobs.js');
importScripts('stream_jobs.js');
