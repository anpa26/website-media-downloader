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

function ambilHeaderTersimpen(url) {
    const entry = urlToHeaderMap.get(url);
    if (!entry) return null;
    if (entry.disimpen && Date.now() - entry.disimpen > HEADER_TTL_MS) {
        urlToHeaderMap.delete(url);
        if (typeof removeHeaderSpoofRules === 'function') removeHeaderSpoofRules(url);
        return null;
    }
    return entry;
}

function golekHeaderTersimpen(url, bolehFallbackAsal = false) {
    const pas = ambilHeaderTersimpen(url);
    if (pas) return pas;
    let tanpaFragment = url;
    try { const u = new URL(url); u.hash = ''; tanpaFragment = u.href; } catch (_) {}
    if (tanpaFragment !== url) {
        const pasTanpaFragment = ambilHeaderTersimpen(tanpaFragment);
        if (pasTanpaFragment) return pasTanpaFragment;
    }
    if (!bolehFallbackAsal) return null;
    let asal = '';
    try { asal = new URL(url).origin; } catch (_) { return null; }
    if (!asal || asal === 'null') return null;
    let palingAnyar = null;
    let wektuPalingAnyar = 0;
    for (const [kunci, entri] of urlToHeaderMap) {
        if (!entri || !entri.disimpen) continue;
        if (Date.now() - entri.disimpen > HEADER_TTL_MS) continue;
        let asalEntri = '';
        try { asalEntri = new URL(kunci).origin; } catch (_) { continue; }
        if (asalEntri !== asal) continue;
        if (entri.disimpen > wektuPalingAnyar) { wektuPalingAnyar = entri.disimpen; palingAnyar = entri; }
    }
    return palingAnyar;
}

function golekiDownload(query) {
    return new Promise((selesai) => {
        try {
            const hasil = browser.downloads.search(query);
            if (hasil && typeof hasil.then === 'function') {
                hasil.then((dl) => selesai(Array.isArray(dl) ? dl : [])).catch(() => selesai([]));
                return;
            }
        } catch (_) {}
        try {
            browser.downloads.search(query, (dl) => selesai(Array.isArray(dl) ? dl : []));
        } catch (_) { selesai([]); }
    });
}

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
        if (name === 'disimpen') continue;
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
            initiatorDomains: [chrome.runtime.id],
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
        const detection = await browser.storage.local.get(['mime-detection', 'url-detection']);
        if (!isFlagEnabled(detection['mime-detection'], true) && !isFlagEnabled(detection['url-detection'], true)) return;
        const res = await browser.storage.session.get('urlToHeaderMap');
        if (res.urlToHeaderMap) {
            const kadaluarsa = [];
            for (const [url, headers] of Object.entries(res.urlToHeaderMap)) {
                if (headers?.disimpen && Date.now() - headers.disimpen > HEADER_TTL_MS) {
                    kadaluarsa.push(url);
                    continue;
                }
                urlToHeaderMap.set(url, headers);
                registerHeaderSpoofRules(url, headers);
            }
            if (kadaluarsa.length) {
                const sisa = { ...res.urlToHeaderMap };
                for (const url of kadaluarsa) delete sisa[url];
                browser.storage.session.set({ 'urlToHeaderMap': sisa }).catch(() => {});
            }
        }
    } catch (e) {
        console.warn("Failed to load persistent headers:", e);
    }
}
loadPersistentHeaders();

setInterval(() => {
    try {
        const saiki = Date.now();
        for (const [url, headers] of urlToHeaderMap) {
            if (headers?.disimpen && saiki - headers.disimpen > HEADER_TTL_MS) {
                urlToHeaderMap.delete(url);
                if (typeof removeHeaderSpoofRules === 'function') removeHeaderSpoofRules(url);
            }
        }
    } catch (_) {}
}, 5 * 60 * 1000);

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

async function savePersistentHeaders() {
    while (urlToHeaderMap.size > 200) {
        const oldestKey = urlToHeaderMap.keys().next().value;
        if (oldestKey === undefined) break;
        urlToHeaderMap.delete(oldestKey);
        removeHeaderSpoofRules(oldestKey);
    }

    const doSave = async () => {
        try {
            const saiki = Date.now();
            for (const [url, headers] of urlToHeaderMap) {
                if (headers?.disimpen && saiki - headers.disimpen > HEADER_TTL_MS) {
                    urlToHeaderMap.delete(url);
                    removeHeaderSpoofRules(url);
                }
            }
            await browser.storage.session.set({ 'urlToHeaderMap': Object.fromEntries(urlToHeaderMap) });
        } catch (e) {
            console.warn("Failed to save persistent headers:", e);
        }
    };

    doSave();
}

function isFlagEnabled(val, defaultVal = false) {
    if (val === undefined) return defaultVal;
    return val === '1' || val === 1 || val === true || val === 'true';
}

browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const isFromExtension = details.initiator?.startsWith('chrome-extension://') ||
                               details.originUrl?.startsWith('moz-extension://') ||
                               details.url.includes('blob:chrome-extension://');
        if (!networkDetectionEnabled(details) && !isFromExtension) return;
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
            const current = ambilHeaderTersimpen(details.url) || {};
            const mergedHeaders = { ...current, ...capturedHeaders, disimpen: Date.now() };
            urlToHeaderMap.set(details.url, mergedHeaders);
            registerHeaderSpoofRules(details.url, mergedHeaders);
            savePersistentHeaders();
        }

        const isMediaRequest = details.type === 'media' ||
                               details.type === 'xmlhttprequest' ||
                               details.type === 'other' ||
                               details.type === 'main_frame' ||
                               details.type === 'sub_frame' ||
                               details.url.includes('download') ||
                               detectionRegex.test(details.url);

        if (isMediaRequest || isFromExtension) {
            const stored = golekHeaderTersimpen(details.url, true);

            details.requestHeaders = details.requestHeaders.filter(h => {
                const val = h.value.toLowerCase();
                return !val.startsWith('chrome-extension://') && !val.startsWith('moz-extension://');
            });

            if (stored) {
                for (const [name, value] of Object.entries(stored)) {
                    if (name === 'disimpen') continue;
                    if (!isFromExtension && (name === 'sec-fetch-site' || name === 'sec-fetch-mode' || name === 'sec-fetch-dest')) continue;
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

                }
            }

            if (isFromExtension) {
                const storedSFS = stored?.['sec-fetch-site'];
                const storedSFM = stored?.['sec-fetch-mode'];
                const storedSFD = stored?.['sec-fetch-dest'];
                let refererHostSama = false;
                try { refererHostSama = !!stored?.referer && details.url.includes(new URL(stored.referer).host); } catch (_) { refererHostSama = false; }

                details.requestHeaders = details.requestHeaders.filter(h =>
                    !['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(h.name.toLowerCase())
                );

                details.requestHeaders.push({
                    name: 'Sec-Fetch-Site',
                    value: storedSFS || (refererHostSama ? 'same-origin' : 'cross-site')
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
if (browser.webRequest.onBeforeRedirect) {
    browser.webRequest.onBeforeRedirect.addListener((details) => {
        if (!details.redirectUrl || !details.url) return;
        const entry = ambilHeaderTersimpen(details.url);
        if (!entry) return;
        let hostAsal = '', hostTujuan = '';
        try {
            hostAsal = new URL(details.url).hostname;
            hostTujuan = new URL(details.redirectUrl).hostname;
        } catch (_) { return; }
        if (hostTujuan !== hostAsal && !hostTujuan.endsWith('.' + hostAsal) && !hostAsal.endsWith('.' + hostTujuan)) return;
        urlToHeaderMap.set(details.redirectUrl, { ...entry, disimpen: Date.now() });
        savePersistentHeaders();
        if (typeof registerHeaderSpoofRules === 'function') registerHeaderSpoofRules(details.redirectUrl, entry);
    }, { urls: ['<all_urls>'] });
}

let cachedSettings = {
    manualScan: false,
    mimeDetection: true,
    urlDetection: true,
    detectDownloadLinks: true,
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
    autoDownloadMedia: false, autoDownloadQuality: 'highest', backgroundDownload: true, autoDownloadAllDomains: false, autoDownloadDomains: '', autoSkipDownloadNames: '', autoSkipDownloadNamesOnly: false, autoSkipDownloadDomains: '', autoIgnoreExcludedMedia: true,
    autoDownloadVideo: true, autoDownloadStream: true,
    themeColor: '#8ab4f8'
};

