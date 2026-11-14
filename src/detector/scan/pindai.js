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

    async function processElement(el, result, detectDownloads, extraExts) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

        let url = (el.tagName === 'IMG' && el.currentSrc) || (el.tagName === 'VIDEO' && el.currentSrc) || (el.tagName === 'AUDIO' && el.currentSrc) || el.src || el.href || el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-href') || el.getAttribute('data-original');
        if (el.tagName === 'SOURCE' || el.tagName === 'TRACK') {
            url = el.src || el.srcset;
        }
        if (url && typeof url === 'string' && !url.startsWith('blob:') && !url.startsWith('data:')) {
            const absolute = getAbsoluteUrl(url);
            if (absolute) {
                if (!(await checkIsSegment(absolute, result))) {
                    const isDownloadAttr = detectDownloads && el.tagName === 'A' && el.hasAttribute('download');
                    const isVideoTag = el.tagName === 'VIDEO' && !isTypeDisabled('video', result);
                    const isAudioTag = el.tagName === 'AUDIO' && !isTypeDisabled('audio', result);
                    const isSourceInMedia = el.tagName === 'SOURCE' && (el.parentElement?.tagName === 'VIDEO' || el.parentElement?.tagName === 'AUDIO');
                    const isAllowedDownload = isDownloadAttr && !isTypeDisabled('file', result);

                    const isImageElement = el.tagName === 'IMG' && /^https?:/i.test(absolute);
                    if (isImageElement || await isMediaUrl(absolute, extraExts, result) || isVideoTag || isAudioTag || isSourceInMedia || isAllowedDownload) {
                        const type = isImageElement ? 'image' : (getUrlType(absolute) || (isVideoTag || el.parentElement?.tagName === 'VIDEO' ? 'video' : (isAudioTag || el.parentElement?.tagName === 'AUDIO' ? 'audio' : null)));
                        if (!isTypeDisabled(type, result)) {
                            const finalUrl = (!getUrlType(absolute) && (type === 'video' || type === 'audio') && !absolute.includes('#video') && !absolute.includes('#audio'))
                                ? `${absolute}#${type}`
                                : absolute;
                            if (!manualScanEnabled(result) || window.__wmdForceManualScan) {
                                detected.add(finalUrl);
                                if (type === 'image') recordImageResourceSize(absolute, el.tagName === 'IMG' ? el : null);
                                if (el.tagName === 'IMG' && el.naturalWidth > 0 && el.naturalHeight > 0) {
                                    detectedImageDimensions.set(absolute, { width: el.naturalWidth, height: el.naturalHeight });
                                }
                            }
                            if (el.tagName === 'IMG' && !watchedImageDimensions.has(el)) {
                                watchedImageDimensions.add(el);
                                el.addEventListener('load', () => {
                                    if (manualScanEnabled() && !window.__wmdForceManualScan) return;
                                    if (el.naturalWidth <= 0 || el.naturalHeight <= 0) return;
                                    const loadedUrl = getAbsoluteUrl(el.currentSrc || el.src || absolute);
                                    if (!loadedUrl || !/^https?:/i.test(loadedUrl)) return;
                                    detected.add(loadedUrl);
                                    detectedImageDimensions.set(loadedUrl, { width: el.naturalWidth, height: el.naturalHeight });
                                    recordImageResourceSize(loadedUrl, el);
                                    if (reportTimeout) clearTimeout(reportTimeout);
                                    reportTimeout = setTimeout(() => report(!!window.__wmdForceManualScan), 500);
                                });
                            }
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
                                    if (type === 'image') recordImageResourceSize(absolute);
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

        if (el.shadowRoot && (maximalDocumentScanEnabled(result) || window.__wmdForceManualScan)) {
            await scanContainer(el.shadowRoot, result, detectDownloads, extraExts, window.__wmdForceManualScan);
        }
    }

    async function scanContainer(container, result, detectDownloads, extraExts, forceManual = false) {
        const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
        const selector = isOpt ? 'img, video, audio, source, track, a, iframe, object, embed, [data-src], [data-url], [data-href], [data-original], [style*="background"]' : '*';
        const elements = container.querySelectorAll(selector);
        for (const el of elements) {
            if (!forceManual && (!contentDetectionEnabled() || !documentScanEnabled())) break;
            await processElement(el, result, detectDownloads, extraExts);
        }
    }

    let scanPending = false;
    let fullScanTimeout = null;
    window.mdu_scan = function(forceManual = false) {
        if (!forceManual && (manualScanEnabled() || !contentDetectionEnabled() || !documentScanEnabled())) return;
        if (fullScanTimeout) clearTimeout(fullScanTimeout);
        fullScanTimeout = setTimeout(async () => {
            if (!forceManual && (manualScanEnabled() || !contentDetectionEnabled() || !documentScanEnabled())) return;
            if (scanPending && !forceManual) return;
            scanPending = true;

            const result = await browser.storage.local.get(contentStorageKeys);
            if (!forceManual && manualScanEnabled(result)) {
                scanPending = false;
                return;
            }
            const detectDownloads = result['detect-download-links'] === '1' || result['detect-download-links'] === true;
            const initialSize = detected.size;
            const extraExts = detectDownloads ? downloadExtensions : [];

            await scanContainer(document, result, detectDownloads, extraExts, forceManual);
            if (!forceManual && (!contentDetectionEnabled() || !documentScanEnabled())) {
                scanPending = false;
                return;
            }

            if (forceManual) {
                try {
                    const resources = performance.getEntriesByType('resource') || [];
                    for (const entry of resources) {
                        if (entry && entry.name && await isMediaUrl(entry.name, extraExts, result)) {
                            const absolute = getAbsoluteUrl(entry.name);
                            if (absolute) {
                                const type = getUrlType(absolute);
                                if (!isTypeDisabled(type, result)) {
                                    detected.add(absolute);
                                    if (type === 'image') recordImageResourceSize(absolute);
                                }
                            }
                        }
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

            if (maximalDocumentScanEnabled(result) || forceManual) try {
                const script = document.createElement('script');
                script.textContent = forceManual ? 'if(window.mdu_deep_scan) window.mdu_deep_scan(true);' : 'if(window.mdu_deep_scan) window.mdu_deep_scan(false);';
                (document.head || document.documentElement).appendChild(script);
                script.remove();
            } catch (e) {}

            if (forceManual || detected.size > initialSize || initialSize === 0) {
                if (reportTimeout) clearTimeout(reportTimeout);
                reportTimeout = setTimeout(() => report(forceManual), forceManual ? 100 : 500);
            }

            scanPending = false;
        }, forceManual ? 20 : 150);
    };
