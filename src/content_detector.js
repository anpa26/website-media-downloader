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
        'url-detection', 'mime-detection', 'youtube-detection', 'detect-download-links', 'hide-segments', 'hide-page-components',
        'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file',
        'ignore-disabled-types', 'optimize-low-end', 'audio-process-notification', 'theme-color',
        'ui-scale'
    ];

    let cachedContentSettings = {};
    let isGlobalOpt = false;
    const settingEnabled = (value, defaultValue = true) => value === undefined || value === null ? defaultValue : value === '1' || value === true;
    const contentDetectionEnabled = (settings = cachedContentSettings) =>
        settingEnabled(settings['url-detection']) ||
        settingEnabled(settings['mime-detection']) ||
        settingEnabled(settings['detect-download-links']);
    function processNotificationsEnabled() {
        return cachedContentSettings['audio-process-notification'] !== '0' &&
            cachedContentSettings['audio-process-notification'] !== false;
    }

    async function updateSettingsCache() {
        try {
            if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
                cachedContentSettings = await browser.storage.local.get(contentStorageKeys);
                syncDetectionState();
            }
        } catch(e) {}
    }
    updateSettingsCache();
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                updateSettingsCache().then(() => {
                    if (changes['theme-color'] || changes['ui-scale']) applyToastTheme();
                    if (changes['audio-process-notification'] && !processNotificationsEnabled()) {
                        hideToast(true);
                        _toastCurrentTaskId = null;
                    }
                });
            }
        });
    }

    window.addEventListener('message', (event) => {
        if (event.data) {
            if (!contentDetectionEnabled() && String(event.data.type || '').startsWith('MDU_') && event.data.type !== 'MDU_UPDATE_SETTINGS') return;
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

            const result = await browser.storage.local.get(contentStorageKeys);
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

            try {
                const script = document.createElement('script');
                script.textContent = 'if(window.mdu_deep_scan) window.mdu_deep_scan();';
                (document.head || document.documentElement).appendChild(script);
                script.remove();
            } catch (e) {}

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

        const result = await browser.storage.local.get(contentStorageKeys);
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

        try {
            const script = document.createElement('script');
            script.textContent = 'if(window.mdu_deep_scan) window.mdu_deep_scan();';
            (document.head || document.documentElement).appendChild(script);
            script.remove();
        } catch (e) {}

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
        document.documentElement?.setAttribute('data-wmd-detection-enabled', enabled ? '1' : '0');
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

    browser.storage.local.get(contentStorageKeys).then((result) => {
        cachedContentSettings = result;
        const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
        isGlobalOpt = isOpt;

        try {
            const drmScript = document.createElement('script');
            drmScript.textContent = `
                (function() {
                    try {
                        const originalRequestMediaKeySystemAccess = navigator.requestMediaKeySystemAccess;
                        if (originalRequestMediaKeySystemAccess && !navigator.mdu_hooked) {
                            navigator.requestMediaKeySystemAccess = function() {
                                if (document.documentElement?.getAttribute('data-wmd-detection-enabled') !== '0') {
                                    window.postMessage({ type: 'MDU_DRM_DETECTED' }, '*');
                                }
                                return originalRequestMediaKeySystemAccess.apply(this, arguments);
                            };
                            navigator.mdu_hooked = true;
                        }
                    } catch (e) {}
                })();
            `;
            (document.head || document.documentElement).appendChild(drmScript);
            drmScript.remove();
        } catch (e) {}

        if (!isOpt && contentDetectionEnabled(result)) {
            try {
                const script = document.createElement('script');
                script.textContent = `
                    (function() {
                        try {
                            const originalAttachShadow = Element.prototype.attachShadow;
                            if (originalAttachShadow && !Element.prototype.mdu_hooked) {
                                Element.prototype.attachShadow = function(init) {
                                    const shadowRoot = originalAttachShadow.apply(this, arguments);
                                    if (document.documentElement?.getAttribute('data-wmd-detection-enabled') === '0') return shadowRoot;
                                    window.postMessage({ type: 'MDU_DOM_CHANGED' }, '*');
                                    try {
                                        const observer = new MutationObserver(() => {
                                            if (document.documentElement?.getAttribute('data-wmd-detection-enabled') !== '0') {
                                                window.postMessage({ type: 'MDU_DOM_CHANGED' }, '*');
                                            }
                                        });
                                        observer.observe(shadowRoot, { childList: true, subtree: true });
                                    } catch (e) {}
                                    return shadowRoot;
                                };
                                Element.prototype.mdu_hooked = true;
                            }

                            const OriginalWebSocket = window.WebSocket;
                            const detectedWs = new Set();
                            window.WebSocket = function(url, protocols) {
                                const ws = new OriginalWebSocket(url, protocols);
                                
                                const checkMedia = async (data) => {
                                    if (document.documentElement?.getAttribute('data-wmd-detection-enabled') === '0') return;
                                    if (detectedWs.has(url)) return;
                                    
                                    try {
                                        let buffer;
                                        if (data instanceof ArrayBuffer) {
                                            buffer = data;
                                        } else if (window.Blob && data instanceof Blob) {
                                            buffer = await data.slice(0, 10).arrayBuffer();
                                        }

                                        if (buffer && buffer.byteLength >= 3) {
                                            const view = new Uint8Array(buffer);
                                            
                                            const isNAL = (view[0] === 0 && view[1] === 0 && view[2] === 1) || 
                                                         (view.byteLength >= 4 && view[0] === 0 && view[1] === 0 && view[2] === 0 && view[3] === 1);
                                            
                                            if (isNAL) {
                                                detectedWs.add(url);
                                                window.postMessage({ type: 'MDU_WS_STREAM_DETECTED', url: url }, '*');
                                            }
                                        }
                                    } catch (e) {}
                                };

                                ws.addEventListener('message', (event) => {
                                    checkMedia(event.data);
                                });

                                return ws;
                            };
                            window.WebSocket.prototype = OriginalWebSocket.prototype;
                            Object.assign(window.WebSocket, OriginalWebSocket);

                            window.mdu_deep_scan = function() {
                                if (document.documentElement?.getAttribute('data-wmd-detection-enabled') === '0') return;
                                const urls = [];
                                try {
                                    if (window.__additionalData) {
                                        const findInObj = (obj, d = 0) => {
                                            if (d > 10 || !obj || typeof obj !== 'object') return;
                                            for (let k in obj) {
                                                if (typeof obj[k] === 'string' && (obj[k].includes('.mp4') || obj[k].includes('.cdninstagram.com')) && obj[k].startsWith('http')) {
                                                    urls.push(obj[k]);
                                                } else if (typeof obj[k] === 'object') findInObj(obj[k], d + 1);
                                            }
                                        };
                                        findInObj(window.__additionalData);
                                    }
                                    if (window.SIGI_STATE) {
                                        if (window.SIGI_STATE.ItemModule) {
                                            Object.values(window.SIGI_STATE.ItemModule).forEach(item => {
                                                if (item.video) {
                                                    if (item.video.downloadAddr) urls.push(item.video.downloadAddr);
                                                    if (item.video.playAddr) urls.push(item.video.playAddr);
                                                }
                                            });
                                        }
                                    }
                                } catch (e) {}
                                if (urls.length > 0) {
                                    window.postMessage({ type: 'MDU_DEEP_URLS_DETECTED', urls: urls }, '*');
                                }
                            };
                        } catch (e) {}
                    })();
                `;
                (document.head || document.documentElement).appendChild(script);
                script.remove();
            } catch (e) {}

        }
        syncDetectionState();
        if (contentDetectionEnabled(result)) window.mdu_scan();
    });

    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && contentStorageKeys.some(key => Object.prototype.hasOwnProperty.call(changes, key))) {
            for (const [key, change] of Object.entries(changes)) cachedContentSettings[key] = change.newValue;
            syncDetectionState();
            if (contentDetectionEnabled()) window.mdu_scan();
        }
    });

    // Floating progress toast logic for background downloading
    const toastStyles = `
        .wmd-toast {
            position: fixed !important;
            bottom: 24px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 2147483647 !important;
            width: auto !important;
            min-width: 320px !important;
            max-width: 480px !important;
            background: rgba(25, 25, 25, 0.45) !important;
            backdrop-filter: blur(20px) !important;
            -webkit-backdrop-filter: blur(20px) !important;
            border: 1px solid rgba(255, 255, 255, 0.18) !important;
            border-radius: 9999px !important;
            box-shadow: 0 12px 40px rgba(0,0,0,0.4) !important;
            font-family: 'Segoe UI', Roboto, sans-serif !important;
            color: #fff !important;
            overflow: hidden !important;
            display: none !important;
            pointer-events: auto !important;
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            animation: wmd-toast-in 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            touch-action: pan-y !important;
            user-select: none !important;
            -webkit-user-select: none !important;
        }
        .wmd-toast.wmd-toast--show {
            display: flex !important;
            flex-direction: column !important;
        }
        .wmd-toast-inner {
            display: flex !important;
            align-items: center !important;
            padding: 14px 20px !important;
            gap: 14px !important;
        }
        .wmd-toast-thumb-placeholder {
            flex-shrink: 0 !important;
            color: var(--wmd-toast-theme, #8ab4f8) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
        .wmd-toast-content {
            flex-grow: 1 !important;
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 2px !important;
            margin-right: 4px !important;
        }
        .wmd-toast-title {
            font-size: 13px !important;
            font-weight: 600 !important;
            color: var(--wmd-toast-theme, #8ab4f8) !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            max-width: 300px !important;
        }
        .wmd-toast-status-row {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            font-size: 12px !important;
        }
        .wmd-toast-status {
            color: rgba(255,255,255,0.9) !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            max-width: 240px !important;
        }
        .wmd-toast-pct {
            color: rgba(255,255,255,0.5) !important;
            font-size: 11px !important;
        }
        .wmd-toast-close {
            background: none !important;
            border: none !important;
            color: rgba(255,255,255,0.4) !important;
            cursor: pointer !important;
            padding: 6px !important;
            border-radius: 50% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important;
        }
        .wmd-toast-close:hover {
            color: #fff !important;
            background: rgba(255,255,255,0.1) !important;
        }
        .wmd-toast-progress-bar {
            position: absolute !important;
            bottom: 0 !important;
            left: 0 !important;
            height: 3px !important;
            background: var(--wmd-toast-theme, #8ab4f8) !important;
            width: 0% !important;
            transition: width 0.3s ease !important;
            opacity: 0.8 !important;
        }
        .wmd-toast--success .wmd-toast-progress-bar {
            background: #4CAF50 !important;
        }
        .wmd-toast--error .wmd-toast-progress-bar {
            background: #F44336 !important;
        }
        @keyframes wmd-toast-in {
            from { bottom: -80px; opacity: 0; transform: translateX(-50%) scale(0.9); }
            to { bottom: 24px; opacity: 1; transform: translateX(-50%) scale(1); }
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.textContent = toastStyles;
    (document.head || document.documentElement).appendChild(styleEl);

    let _toastEl = null;
    let _toastBarEl = null;
    let _toastStatusEl = null;
    let _toastPctEl = null;
    let _toastHideTimer = null;
    let _toastCurrentTaskId = null;
    let _activeCancellations = new Set();
    const _activeDownloads = new Map();

    function getToastThemeColor() {
        const color = String(cachedContentSettings['theme-color'] || '').trim();
        return /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(color)
            ? color
            : '#8ab4f8';
    }

    function getToastScale() {
        return cachedContentSettings['ui-scale'] || '85%';
    }

    function applyToastTheme() {
        if (_toastEl) {
            _toastEl.style.setProperty('--wmd-toast-theme', getToastThemeColor());
            _toastEl.style.zoom = getToastScale();
        }
    }

    function getOrCreateToast() {
        if (_toastEl && document.body.contains(_toastEl)) {
            applyToastTheme();
            return _toastEl;
        }
        _toastEl = document.createElement('div');
        _toastEl.className = 'wmd-toast mdu-toast-surface';
        _toastEl.innerHTML = `
            <div class="wmd-toast-inner">
                <div class="wmd-toast-thumb-placeholder">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
                <div class="wmd-toast-content">
                    <div class="wmd-toast-title" id="wmd-title">Audio Only</div>
                    <div class="wmd-toast-status-row">
                        <span class="wmd-toast-status" id="wmd-status">Starting...</span>
                        <span class="wmd-toast-pct" id="wmd-pct">0%</span>
                    </div>
                </div>
                <button class="wmd-toast-close" id="wmd-close" title="Cancel">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="wmd-toast-progress-bar" id="wmd-bar" style="width:0%"></div>
        `;
        applyToastTheme();
        document.body.appendChild(_toastEl);
        _toastBarEl = _toastEl.querySelector('#wmd-bar');
        _toastStatusEl = _toastEl.querySelector('#wmd-status');
        _toastPctEl = _toastEl.querySelector('#wmd-pct');
        _toastEl.querySelector('#wmd-close').addEventListener('click', () => {
            if (_toastCurrentTaskId) {
                if (_toastCurrentTaskId.startsWith('audio_') || _toastCurrentTaskId.startsWith('stream_') || _toastCurrentTaskId.startsWith('zip_')) {
                    browser.runtime.sendMessage({ action: 'cancelDownload', id: _toastCurrentTaskId }).catch(() => {});
                }
                _activeCancellations.add(_toastCurrentTaskId);
                _activeDownloads.delete(_toastCurrentTaskId);
            }
            hideToast(true);
        });
        return _toastEl;
    }

    function showToast(taskId, filename, audioOnly = false) {
        if (_toastHideTimer) {
            clearTimeout(_toastHideTimer);
            _toastHideTimer = null;
        }
        _toastCurrentTaskId = taskId;
        _activeDownloads.set(taskId, {
            id: taskId,
            url: taskId,
            filename: filename || 'Downloading...',
            loaded: 0,
            total: 100,
            percent: 0,
            status: 'Starting...',
            isParallel: false,
            isPaused: false,
            mediaType: audioOnly ? 'audio' : 'video'
        });
        const toast = getOrCreateToast();
        toast.classList.remove('wmd-toast--success', 'wmd-toast--error');
        toast.classList.add('wmd-toast--show');
        toast.querySelector('#wmd-title').textContent = filename || (audioOnly ? 'Audio Only' : 'Downloading...');
        if (_toastBarEl) _toastBarEl.style.width = '0%';
        if (_toastPctEl) _toastPctEl.textContent = '0%';
        if (_toastStatusEl) _toastStatusEl.textContent = filename || 'Starting...';
    }

    function updateToastProgress(progress) {
        if (!_toastEl) return;
        const percent = Math.min(100, Math.round(progress));
        if (_toastBarEl) _toastBarEl.style.width = `${percent}%`;
        if (_toastPctEl) _toastPctEl.textContent = `${percent}%`;
        if (_toastCurrentTaskId) {
            const item = _activeDownloads.get(_toastCurrentTaskId);
            if (item) {
                item.percent = percent;
                item.loaded = percent;
            }
            browser.runtime.sendMessage({
                action: 'customStatus',
                id: _toastCurrentTaskId,
                percent: percent
            }).catch(() => {});
        }
    }

    function updateToastStatus(statusText) {
        statusText = String(statusText || '');
        const percentMatches = [...statusText.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*%/g)];
        if (percentMatches.length > 0) {
            const percent = Math.min(100, Math.round(Number(percentMatches[percentMatches.length - 1][1])));
            if (_toastBarEl) _toastBarEl.style.width = `${percent}%`;
            if (_toastPctEl) _toastPctEl.textContent = `${percent}%`;
            const item = _toastCurrentTaskId ? _activeDownloads.get(_toastCurrentTaskId) : null;
            if (item) {
                item.percent = percent;
                item.loaded = percent;
            }
        }
        statusText = statusText
            .replace(/\s*\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)/g, '')
            .replace(/\s*\d{1,3}(?:\.\d+)?\s*%/g, '')
            .replace(/:\s*$/, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        if (!statusText) statusText = 'Processing...';
        if (_toastStatusEl) _toastStatusEl.textContent = statusText;
        if (_toastCurrentTaskId) {
            const item = _activeDownloads.get(_toastCurrentTaskId);
            if (item) {
                item.status = statusText;
            }
            browser.runtime.sendMessage({
                action: 'customStatus',
                id: _toastCurrentTaskId,
                text: statusText
            }).catch(() => {});
        }
    }

    function finishToast(success, message) {
        if (!_toastEl) return;
        _toastEl.classList.remove('wmd-toast--success', 'wmd-toast--error');
        _toastEl.classList.add(success ? 'wmd-toast--success' : 'wmd-toast--error');
        if (_toastBarEl) _toastBarEl.style.width = success ? '100%' : _toastBarEl.style.width;
        if (_toastPctEl) _toastPctEl.textContent = success ? '100%' : _toastPctEl.textContent;
        if (_toastStatusEl) _toastStatusEl.textContent = message || (success ? 'Done!' : 'Failed');
        
        if (_toastCurrentTaskId) {
            _activeDownloads.delete(_toastCurrentTaskId);
            browser.runtime.sendMessage({
                action: 'customStatus',
                id: _toastCurrentTaskId,
                text: message || (success ? 'Done!' : 'Failed'),
                percent: success ? 100 : undefined
            }).catch(() => {});

            if (success) {
                browser.runtime.sendMessage({
                    action: 'downloadComplete',
                    id: _toastCurrentTaskId,
                    url: _toastCurrentTaskId
                }).catch(() => {});
            } else {
                browser.runtime.sendMessage({
                    action: 'downloadError',
                    id: _toastCurrentTaskId,
                    url: _toastCurrentTaskId,
                    error: message === 'Cancelled' ? 'USER_CANCELED' : message
                }).catch(() => {});
            }
        }

        _toastCurrentTaskId = null;
        _toastHideTimer = setTimeout(() => hideToast(false), 4000);
    }

    function hideToast(immediate) {
        if (!_toastEl) return;
        _toastEl.classList.remove('wmd-toast--show');
    }

    function applyAudioJobUpdate(message) {
        if (!processNotificationsEnabled()) {
            if (_toastCurrentTaskId === message.jobId) hideToast(true);
            return;
        }
        if (!_toastEl || _toastCurrentTaskId !== message.jobId) {
            showToast(message.jobId, message.filename || 'Audio Only', true);
        }
        const title = _toastEl.querySelector('#wmd-title');
        if (title && message.filename) {
            title.textContent = message.total > 0
                ? `${message.filename} • ${(message.total / 1048576).toFixed(1)} MB`
                : message.filename;
        }
        let detail = message.text || '';
        if (/^Downloading/i.test(detail) && message.total > 0) detail += ` ${(message.loaded / 1048576).toFixed(1)} MB / ${(message.total / 1048576).toFixed(1)} MB`;
        else if (/^Downloading/i.test(detail) && message.loaded > 0) detail += ` ${(message.loaded / 1048576).toFixed(1)} MB`;
        if (detail && _toastStatusEl) _toastStatusEl.textContent = detail;
        if (message.percent !== undefined && message.percent !== null) {
            const percent = Math.min(100, Math.round(message.percent));
            if (_toastBarEl) _toastBarEl.style.width = `${percent}%`;
            if (_toastPctEl) _toastPctEl.textContent = `${percent}%`;
            const localItem = _activeDownloads.get(message.jobId);
            if (localItem) {
                localItem.percent = percent;
                localItem.loaded = message.loaded || 0;
                localItem.total = message.total || 0;
                localItem.status = message.text || localItem.status;
            }
        }
        if (message.indeterminate && _toastPctEl) _toastPctEl.textContent = '…';
        if (message.complete) {
            _toastEl.classList.remove('wmd-toast--success', 'wmd-toast--error');
            _toastEl.classList.add(message.success ? 'wmd-toast--success' : 'wmd-toast--error');
            _activeDownloads.delete(message.jobId);
            _toastHideTimer = setTimeout(() => hideToast(false), 4000);
        }
    }

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'ping') {
            sendResponse({ pong: true });
            return true;
        }
        if (message.action === 'get_active_downloads') {
            sendResponse(Object.fromEntries(_activeDownloads));
            return true;
        }
        if (message.action === 'audioJobUpdate' || message.action === 'streamJobUpdate' || message.action === 'zipJobUpdate') {
            applyAudioJobUpdate(message);
            sendResponse({ success: true });
            return;
        }
        if (message.action === 'audioFetchProgress') {
            if (message.url === _toastCurrentTaskId) {
                if (message.total > 0) {
                    const percent = (message.loaded / message.total) * 100;
                    updateToastProgress(percent);
                    updateToastStatus(`Downloading: ${Math.round(percent)}%`);
                } else {
                    updateToastStatus(`Downloaded ${(message.loaded / 1048576).toFixed(1)}MB`);
                }
            }
            return;
        }
        if (message.action === 'cancelDownload') {
            const url = message.url;
            if (url) {
                _activeCancellations.add(url);
                _activeDownloads.delete(url);
                hideToast(true);
            }
            sendResponse({ success: true });
            return true;
        }
        if (message.action === 'start_tab_download') {
            const { url, filename, isYouTube, audioOnly, directAudioSource, encodeM4aToMp3, request } = message;
            _activeCancellations.delete(url);
            if (processNotificationsEnabled()) showToast(url, filename, audioOnly);

            const mockLoadingBar = {
                parentNode: {
                    querySelector: (selector) => {
                        if (selector === '.download-status-info') {
                            return {
                                set textContent(val) { updateToastStatus(val); },
                                get textContent() { return ""; }
                            };
                        }
                        return null;
                    }
                },
                setAttribute: () => {},
                removeAttribute: () => {},
                set value(val) { updateToastProgress(val); },
                get value() { return 0; },
                set max(val) {}
            };

            const checkCancel = () => _activeCancellations.has(url);

            (async () => {
                try {
                    let finalBlob;
                    let finalFilename = filename;

                    if (isYouTube) {
                        updateToastStatus('Fetching metadata...');
                        const uint8Array = await window.fetchAsUint8ArrayChunked(url, mockLoadingBar, { set textContent(val) { updateToastStatus(val); } }, checkCancel);
                        finalBlob = new Blob([uint8Array.buffer]);
                    } else {
                        updateToastStatus('Connecting...');
                        const result = await browser.runtime.sendMessage({
                            action: 'fetchMediaForAudio',
                            url,
                            request
                        });
                        if (!result || !result.success) throw new Error(result?.error || 'Media download failed');
                        if (checkCancel()) throw new Error('Cancelled');
                        finalBlob = new Blob([result.arrayBuffer], { type: result.mime || 'application/octet-stream' });
                    }

                    if (encodeM4aToMp3) {
                        updateToastStatus('Converting M4A to MP3...');
                        const result = await convertM4aToMp3Direct(finalBlob, filename, mockLoadingBar, checkCancel);
                        finalBlob = result.blob;
                        finalFilename = result.filename;
                    } else if (audioOnly && !directAudioSource) {
                        updateToastStatus('Extracting Audio...');
                        const wavBlob = await offlineExtractAudioToWav(finalBlob, mockLoadingBar, checkCancel);
                        let finalResult = { blob: wavBlob, filename: filename };
                        if (typeof convertAudioToMp3IfEnabled !== 'undefined') {
                            finalResult = await convertAudioToMp3IfEnabled(wavBlob, filename, mockLoadingBar, checkCancel);
                        }
                        finalBlob = finalResult.blob;
                        finalFilename = finalResult.filename;
                    }

                    const arrayBuffer = await finalBlob.arrayBuffer();
                    browser.runtime.sendMessage({
                        action: 'download_arraybuffer',
                        arrayBuffer,
                        filename: finalFilename,
                        mime: finalBlob.type
                    }).then((res) => {
                        if (res && res.success) {
                            finishToast(true, 'Complete!');
                        } else {
                            finishToast(false, res ? res.error : 'Save failed');
                        }
                    }).catch(err => {
                        finishToast(false, err.message);
                    });

                } catch (e) {
                    if (e.message === 'Cancelled') {
                        finishToast(false, 'Cancelled');
                    } else {
                        console.error('Background download error:', e);
                        finishToast(false, e.message);
                    }
                }
            })();

            sendResponse({ success: true });
            return true;
        }
    });

    browser.runtime.sendMessage({ action: 'getActiveDownloads' }).then(items => {
        const jobs = Object.values(items || {}).filter(item => item.isAudioJob || item.isStreamJob || item.isPersistentZipJob);
        if (jobs.length) {
            const job = jobs[jobs.length - 1];
            applyAudioJobUpdate({
                action: job.isPersistentZipJob ? 'zipJobUpdate' : (job.isStreamJob ? 'streamJobUpdate' : 'audioJobUpdate'),
                jobId: job.id, filename: job.filename,
                text: job.statusText || job.status, percent: job.percent, indeterminate: !job.total
                , loaded: job.loaded, total: job.total
            });
        }
    }).catch(() => {});

    window.mdu_detector_injected = true;
})();
