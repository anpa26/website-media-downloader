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

async function loadPersistentHeaders() {
    try {
        const detection = await browser.storage.local.get(['mime-detection', 'url-detection', 'youtube-detection']);
        if (!isFlagEnabled(detection['mime-detection'], true) && !isFlagEnabled(detection['url-detection'], true) && !isFlagEnabled(detection['youtube-detection'], true)) return;
        const res = await browser.storage.session.get('urlToHeaderMap');
        if (res.urlToHeaderMap) {
            for (const [url, headers] of Object.entries(res.urlToHeaderMap)) {
                if (headers?.disimpen && Date.now() - headers.disimpen > HEADER_TTL_MS) continue;
                urlToHeaderMap.set(url, headers);
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
    while (urlToHeaderMap.size > 200) {
        const oldestKey = urlToHeaderMap.keys().next().value;
        if (oldestKey === undefined) break;
        urlToHeaderMap.delete(oldestKey);
    }

    const doSave = async () => {
        try {
            const saiki = Date.now();
            for (const [url, headers] of urlToHeaderMap) {
                if (headers?.disimpen && saiki - headers.disimpen > HEADER_TTL_MS) urlToHeaderMap.delete(url);
            }
            await browser.storage.session.set({ 'urlToHeaderMap': Object.fromEntries(urlToHeaderMap) });
        } catch (e) {
            console.warn("Failed to save persistent headers:", e);
        }
    };

    if (savePersistentHeadersTimeout) return;
    const debounceMs = isOptimizeLowEnd ? 1500 : 1000;
    savePersistentHeadersTimeout = setTimeout(() => {
        savePersistentHeadersTimeout = null;
        doSave();
    }, debounceMs);
}

function isFlagEnabled(val, defaultVal = false) {
    if (val === undefined) return defaultVal;
    return val === '1' || val === 1 || val === true || val === 'true';
}

browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const isFromExtension = details.initiator?.startsWith('chrome-extension://') ||
                                details.originUrl?.startsWith('moz-extension://') ||
                                details.url.includes('blob:chrome-extension://') ||
                                details.url.includes('blob:moz-extension://');
        if (!networkDetectionEnabled(details) && !isFromExtension) return;

        if (isFromExtension && (details.url.includes('/youtubei/v1/player') || details.url.includes('googlevideo.com') || details.url.includes('youtube.com'))) {
            let hasOrigin = false;
            let hasReferer = false;
            for (let h of details.requestHeaders) {
                const name = h.name.toLowerCase();
                if (name === 'origin') {
                    h.value = 'https://www.youtube.com';
                    hasOrigin = true;
                } else if (name === 'referer') {
                    h.value = 'https://www.youtube.com/';
                    hasReferer = true;
                }
            }
            if (!hasOrigin) {
                details.requestHeaders.push({ name: 'Origin', value: 'https://www.youtube.com' });
            }
            if (!hasReferer) {
                details.requestHeaders.push({ name: 'Referer', value: 'https://www.youtube.com/' });
            }
            return { requestHeaders: details.requestHeaders };
        }

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
            urlToHeaderMap.set(details.url, { ...current, ...capturedHeaders, disimpen: Date.now() });
            savePersistentHeaders();
        }



        const isMediaRequest = details.type === 'media' ||
                               details.type === 'xmlhttprequest' ||
                               details.type === 'other' ||
                               details.type === 'main_frame' ||
                               details.type === 'sub_frame' ||
                               details.url.includes('download') ||
                               detectionRegex.test(details.url);

        // Filter extension-origin values from all requests (harmless, web pages won't have these anyway)
        if (isMediaRequest || isFromExtension) {
            details.requestHeaders = details.requestHeaders.filter(h => {
                const val = h.value.toLowerCase();
                return !val.startsWith('chrome-extension://') && !val.startsWith('moz-extension://');
            });
        }

        if (isMediaRequest || isFromExtension) {
            const stored = golekHeaderTersimpen(details.url, true);

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
        }

        const cookieHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'cookie');
        if (cookieHeader) temporaryCookieMap.set(details.requestId, cookieHeader.value);

        return { requestHeaders: details.requestHeaders };
    },
    { urls: ["<all_urls>"] },
    ["blocking", "requestHeaders"]
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
    youtubeDetection: true,
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
    autoDownloadMedia: false, autoDownloadQuality: 'highest', autoDownloadYoutubeMode: 'video', backgroundDownload: true, autoDownloadAllDomains: false, autoDownloadDomains: '', autoSkipDownloadNames: '', autoSkipDownloadNamesOnly: false, autoSkipDownloadDomains: '', autoIgnoreExcludedMedia: true,
    autoDownloadVideo: true, autoDownloadStream: true,
    themeColor: '#8ab4f8'
};

function sanitizeFilename(name) {
    if (!name) return name;
    return name.split('/').map(segment => {
        return segment.replace(/[\\:*?"<>|\x00-\x1F]/g, '_').trim();
    }).filter(segment => segment !== '' && segment !== '..').join('/');
}
