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

(() => {
    if (window.mdu_detector_injected) {
        if (window.mdu_scan) window.mdu_scan();
        return;
    }

    if (typeof browser === 'undefined') {
        var browser = chrome;
    }

    const contentStorageKeys = [
        'url-detection', 'mime-detection', 'detect-download-links', 'hide-segments', 'hide-page-components',
        'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file',
        'ignore-disabled-types', 'optimize-low-end'
    ];

    let cachedContentSettings = {};
    let isGlobalOpt = false;
    const settingEnabled = (value, defaultValue = true) => value == null ? defaultValue : value === '1' || value === true;
    const contentDetectionEnabled = (settings = cachedContentSettings) =>
        settingEnabled(settings['url-detection']) || settingEnabled(settings['mime-detection']) || settingEnabled(settings['detect-download-links']);
    async function safeStorageGet(keys) {
        try {
            if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
                return await browser.storage.local.get(keys);
            }
        } catch(e) {}
        return {};
    }
    async function updateSettingsCache() {
        cachedContentSettings = await safeStorageGet(contentStorageKeys);
    }
    updateSettingsCache();
    try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
            browser.storage.onChanged.addListener((changes, area) => {
                if (area === 'local') updateSettingsCache();
            });
        }
    } catch(e) {}

    window.addEventListener('message', (event) => {
        if (event.data) {
            if (!contentDetectionEnabled() && String(event.data.type || '').startsWith('MDU_')) return;
            if (event.data.type === 'MDU_DRM_DETECTED') {
                try {
                    browser.runtime.sendMessage({ action: 'drmDetected' });
                } catch (e) {}
            } else if (event.data.type === 'MDU_DOM_CHANGED') {
                if (!isGlobalOpt) {
                    if (window.mdu_scan) window.mdu_scan();
                }
            } else if (event.data.type === 'MDU_WS_STREAM_DETECTED') {
                if (event.data.url) {
                    const absolute = getAbsoluteUrl(event.data.url);
                    if (absolute && !detected.has(absolute)) {
                        const type = getUrlType(absolute) || 'stream';
                        if (!isTypeDisabled(type, cachedContentSettings)) {
                            detected.add(absolute);
                            if (reportTimeout) clearTimeout(reportTimeout);
                            reportTimeout = setTimeout(report, 500);
                        }
                    }
                }
            } else if (event.data.type === 'MDU_DEEP_URLS_DETECTED') {
                if (event.data.urls && Array.isArray(event.data.urls)) {
                    event.data.urls.forEach(url => {
                        const absolute = getAbsoluteUrl(url);
                        if (absolute && !detected.has(absolute)) {
                            const type = getUrlType(absolute);
                            if (!isTypeDisabled(type, cachedContentSettings)) {
                                detected.add(absolute);
                                if (reportTimeout) clearTimeout(reportTimeout);
                                reportTimeout = setTimeout(report, 500);
                            }
                        }
                    });
                }
            }
        }
    });

    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"];
    const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif"];
    const downloadExtensions = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];
    const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions, subtitleExtensions, imageExtensions);

    async function checkIsSegment(url, settings) {
        if (!url) return false;
        const urlLower = url.toLowerCase();
        
        const isHideSegments = settings?.['hide-segments'] === '1';
        const isHidePageComponents = settings?.['hide-page-components'] === '1';
        const isOnlyImage = settings?.['only-image'] === '1';

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

            if (isOnlyImage && (path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.webp') || path.endsWith('.png'))) {
                return false;
            }
            return true;
        }

        if (!isHideSegments) return false;

        return path.endsWith('.ts') || 
               path.endsWith('.m4s') || 
               path.endsWith('.m4v') || 
               path.endsWith('.m4a') ||
               path.endsWith('.m2ts') ||
               path.endsWith('.mts');
    }

    function getUrlType(url) {
        if (!url || typeof url !== 'string') return null;
        const urlLower = url.toLowerCase();
        
        if (urlLower.includes('mime=video') || urlLower.includes('#video')) return 'video';
        if (urlLower.includes('mime=audio') || urlLower.includes('#audio')) return 'audio';

        const urlPath = urlLower.split('?')[0].split('#')[0];
        const hasExt = (ext) => urlPath.endsWith(ext) || urlLower.includes(ext + '&') || urlLower.includes(ext + '?') || urlLower.includes(ext + '#') || urlLower.endsWith(ext);

        if (videoExtensions.some(hasExt)) return 'video';
        if (audioExtensions.some(hasExt)) return 'audio';
        if (streamExtensions.some(hasExt) || urlLower.includes('#stream')) return 'stream';
        if (subtitleExtensions.some(hasExt) || urlLower.includes('#subtitle')) return 'subtitle';
        if (imageExtensions.some(hasExt) || urlLower.includes('#image')) return 'image';
        if (downloadExtensions.some(hasExt) || urlLower.includes('#file')) return 'file';
        return null;
    }

    function isTypeDisabled(type, settings) {
        const isIgnoreDisabled = settings?.['ignore-disabled-types'] === '1' || settings?.['ignore-disabled-types'] === true || settings?.['optimize-low-end'] === '1' || settings?.['optimize-low-end'] === true;
        if (!isIgnoreDisabled) return false;

        const isFlagEnabled = (val, defaultVal) => {
            if (val === undefined || val === null) return defaultVal;
            return val === '1' || val === true;
        };

        if (type === 'video' && !isFlagEnabled(settings?.['only-video'], true)) return true;
        if (type === 'audio' && !isFlagEnabled(settings?.['only-audio'], true)) return true;
        if (type === 'stream' && !isFlagEnabled(settings?.['only-stream'], true)) return true;
        if (type === 'image' && !isFlagEnabled(settings?.['only-image'], false)) return true;
        if (type === 'subtitle' && !isFlagEnabled(settings?.['only-subtitle'], false)) return true;
        if (type === 'file' && !isFlagEnabled(settings?.['only-file'], true)) return true;

        return false;
    }

    async function isMediaUrl(url, extraExtensions = [], settings = {}) {
        if (!url || typeof url !== 'string') return false;
        const urlLower = url.toLowerCase();

        if (await checkIsSegment(url, settings)) return false;

        if (urlLower.startsWith('chrome-extension://') ||
            urlLower.startsWith('moz-extension://') ||
            urlLower.startsWith('blob:chrome-extension://') ||
            urlLower.startsWith('blob:moz-extension://')) {
            return false;
        }

        try {
            const path = new URL(url, window.location.href).pathname.toLowerCase();
            const type = getUrlType(url);
            if (type && isTypeDisabled(type, settings)) {
                return false;
            }

            const extensionsToCheck = allExtensions.concat(extraExtensions);
            return extensionsToCheck.some(ext => path.endsWith(ext));
        } catch (e) {
            return false;
        }
    }

    function getAbsoluteUrl(url) {
        try {
            return new URL(url, window.location.href).href;
        } catch (e) {
            return null;
        }
    }

    function getPageTitle() {
        let title = "";
        try {
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle && ogTitle.content) {
                title = ogTitle.content;
            } else {
                const h1 = document.querySelector('h1');
                if (h1 && h1.innerText) {
                    title = h1.innerText.trim();
                } else {
                    title = document.title;
                }
            }
        } catch (e) {}
        return title || document.title;
    }

    const detected = new Set();
    let reportTimeout = null;

    function report() {
        if (detected.size === 0) return;
        try {
            chrome.runtime.sendMessage({
                action: 'reportDetectedMedia',
                urls: Array.from(detected),
                pageTitle: getPageTitle(),
                pageUrl: window.location.href
            });
        } catch (e) {}
    }

    async function processElement(el, result, detectDownloads, extraExts) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

        let url = el.src || el.href || el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-href') || el.getAttribute('data-original');
        if (el.tagName === 'SOURCE' || el.tagName === 'TRACK') {
            url = el.src || el.srcset;
        }
        if (url && typeof url === 'string') {
            const absolute = getAbsoluteUrl(url);
            if (absolute) {
                if (!(await checkIsSegment(absolute, result))) {
                    const isDownloadAttr = detectDownloads && el.tagName === 'A' && el.hasAttribute('download');
                    const isVideoTag = el.tagName === 'VIDEO' && !isTypeDisabled('video', result);
                    const isAudioTag = el.tagName === 'AUDIO' && !isTypeDisabled('audio', result);
                    const isAllowedDownload = isDownloadAttr && !isTypeDisabled('file', result);

                    if (await isMediaUrl(absolute, extraExts, result) || isVideoTag || isAudioTag || isAllowedDownload) {
                        const type = getUrlType(absolute);
                        if (!isTypeDisabled(type, result)) {
                            detected.add(absolute);
                        }
                    }
                }
            }
        }

        try {
            if (!isTypeDisabled('image', result)) {
                const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
                const bg = isOpt ? el.style.backgroundImage : (el.style.backgroundImage || window.getComputedStyle(el).backgroundImage);
                if (bg && bg !== 'none') {
                    const match = bg.match(/url\(['"]?([^'"]+)['"]?\)/);
                    if (match && match[1]) {
                        const absolute = getAbsoluteUrl(match[1]);
                        if (absolute && await isMediaUrl(absolute, extraExts, result)) {
                            if (!(await checkIsSegment(absolute, result))) {
                                const type = getUrlType(absolute) || 'image';
                                if (!isTypeDisabled(type, result)) {
                                    detected.add(absolute);
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {}

        const attrs = el.attributes;
        for (let i = 0; i < attrs.length; i++) {
            const attr = attrs[i];
            const attrName = attr.name.toLowerCase();
            if (attrName === 'src' || attrName === 'href' || attrName === 'style') continue;
            if ((attrName.startsWith('data-') || attrName === 'value' || attrName === 'action' || attrName === 'formaction') && await isMediaUrl(attr.value, extraExts, result)) {
                const absolute = getAbsoluteUrl(attr.value);
                if (absolute) {
                    if (!(await checkIsSegment(absolute, result))) {
                        const type = getUrlType(absolute);
                        if (!isTypeDisabled(type, result)) {
                            detected.add(absolute);
                        }
                    }
                }
            }
        }

        if (el.shadowRoot) {
            await scanContainer(el.shadowRoot, result, detectDownloads, extraExts);
        }
    }

    async function scanContainer(container, result, detectDownloads, extraExts) {
        const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
        const selector = isOpt ? 'img, video, audio, source, track, a, iframe, object, embed, [data-src], [data-url], [data-href], [data-original], [style*="background"]' : '*';
        const elements = container.querySelectorAll(selector);
        for (const el of elements) {
            if (!contentDetectionEnabled()) break;
            await processElement(el, result, detectDownloads, extraExts);
        }
    }

    let scanPending = false;
    let fullScanTimeout = null;
    window.mdu_scan = function() {
        if (!contentDetectionEnabled()) return;
        if (fullScanTimeout) clearTimeout(fullScanTimeout);
        fullScanTimeout = setTimeout(async () => {
            if (!contentDetectionEnabled()) return;
            if (scanPending) return;
            scanPending = true;

            const result = await safeStorageGet(contentStorageKeys);
            const detectDownloads = result['detect-download-links'] === '1' || result['detect-download-links'] === true;
            const initialSize = detected.size;
            const extraExts = detectDownloads ? downloadExtensions : [];

            await scanContainer(document, result, detectDownloads, extraExts);
            if (!contentDetectionEnabled()) {
                scanPending = false;
                return;
            }

            if (window.mdu_run_surgical_scrapers) {
                const surgicalUrls = window.mdu_run_surgical_scrapers();
                surgicalUrls.forEach(url => {
                    const absolute = getAbsoluteUrl(url);
                    if (absolute) {
                        const type = getUrlType(absolute) || 'video';
                        if (!isTypeDisabled(type, result)) detected.add(absolute);
                    }
                });
            }

            window.postMessage({ type: 'MDU_TRIGGER_DEEP_SCAN' }, '*');

            if (detected.size > initialSize || initialSize === 0) {
                if (reportTimeout) clearTimeout(reportTimeout);
                reportTimeout = setTimeout(report, 500);
            }

            scanPending = false;
        }, 150);
    };

    let scanTimeout = null;
    let pendingNodesToScan = new Set();

    async function processPendingNodes() {
        if (!contentDetectionEnabled()) {
            pendingNodesToScan.clear();
            return;
        }
        if (pendingNodesToScan.size === 0) return;
        const nodes = Array.from(pendingNodesToScan);
        pendingNodesToScan.clear();

        const result = await safeStorageGet(contentStorageKeys);
        const detectDownloads = result['detect-download-links'] === '1' || result['detect-download-links'] === true;
        const initialSize = detected.size;
        const extraExts = detectDownloads ? downloadExtensions : [];

        for (const node of nodes) {
            if (!contentDetectionEnabled()) return;
            if (!node.isConnected) continue;
            await processElement(node, result, detectDownloads, extraExts);
            try {
                const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
                const selector = isOpt ? 'img, video, audio, source, track, a, iframe, object, embed, [data-src], [data-url], [data-href], [data-original], [style*="background"]' : '*';
                const elements = node.querySelectorAll(selector);
                for (const el of elements) {
                    if (!contentDetectionEnabled()) break;
                    await processElement(el, result, detectDownloads, extraExts);
                }
            } catch (e) {}
        }

        if (window.mdu_run_surgical_scrapers) {
            const surgicalUrls = window.mdu_run_surgical_scrapers();
            surgicalUrls.forEach(url => {
                const absolute = getAbsoluteUrl(url);
                if (absolute) {
                    const type = getUrlType(absolute) || 'video';
                    if (!isTypeDisabled(type, result)) detected.add(absolute);
                }
            });
        }

        window.postMessage({ type: 'MDU_TRIGGER_DEEP_SCAN' }, '*');

        if (detected.size > initialSize || initialSize === 0) {
            if (reportTimeout) clearTimeout(reportTimeout);
            reportTimeout = setTimeout(report, 500);
        }
    }

    function queueNodesForScan(nodes) {
        nodes.forEach(node => pendingNodesToScan.add(node));
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(processPendingNodes, 100);
    }

    const observer = new MutationObserver((mutations) => {
        if (!contentDetectionEnabled()) return;
        const addedElements = [];
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    addedElements.push(node);
                }
            }
        }
        if (addedElements.length > 0) {
            queueNodesForScan(addedElements);
        }
    });

    let isObserving = false;
    function syncDetectionState() {
        const enabled = contentDetectionEnabled();
        const isOpt = cachedContentSettings['optimize-low-end'] === '1' || cachedContentSettings['optimize-low-end'] === true;
        isGlobalOpt = isOpt;
        window.postMessage({ type: 'MDU_UPDATE_SETTINGS', optimizeLowEnd: isOpt, detectionEnabled: enabled }, '*');
        if ((!enabled || isOpt) && isObserving) {
            observer.disconnect();
            isObserving = false;
            pendingNodesToScan.clear();
        } else if (enabled && !isOpt && !isObserving && document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
            isObserving = true;
        }
    }

    safeStorageGet(contentStorageKeys).then((result) => {
        cachedContentSettings = result;
        const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
        isGlobalOpt = isOpt;

        syncDetectionState();
        if (contentDetectionEnabled(result)) window.mdu_scan();
    }).catch(() => {});

    try {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && contentStorageKeys.some(key => Object.prototype.hasOwnProperty.call(changes, key))) {
                for (const [key, change] of Object.entries(changes)) cachedContentSettings[key] = change.newValue;
                syncDetectionState();
                if (contentDetectionEnabled()) window.mdu_scan();
            }
        });
    } catch(e) {}

    window.mdu_detector_injected = true;
})();
