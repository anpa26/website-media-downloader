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

    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp"];
    const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif"];
    const downloadExtensions = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];
    const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions, subtitleExtensions, imageExtensions);

    async function checkIsSegment(url, settings) {
        if (!url) return false;
        const urlLower = url.toLowerCase();
        
        const isHideSegments = settings?.['hide-segments'] === '1';
        const isHidePageComponents = settings?.['hide-page-components'] === '1';
        const isOnlyImage = settings?.['only-image'] === '1';

        // Page components extensions - more precise check
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
            
            // If 'only-image' is enabled, don't hide images
            if (isOnlyImage && (path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.webp') || path.endsWith('.png'))) {
                return false;
            }
            return true;
        }

        if (!isHideSegments) return false;

        // Without headers, we can only check extensions
        return path.endsWith('.ts') || 
               path.endsWith('.m4s') || 
               path.endsWith('.m4v') || 
               path.endsWith('.m4a') ||
               path.endsWith('.m2ts') ||
               path.endsWith('.mts');
    }

    async function isMediaUrl(url, extraExtensions = [], settings = {}) {
        if (!url || typeof url !== 'string') return false;
        const urlLower = url.toLowerCase();

        // Check if it's a segment/component first
        if (await checkIsSegment(url, settings)) return false;

        if (urlLower.startsWith('chrome-extension://') ||
            urlLower.startsWith('moz-extension://') ||
            urlLower.startsWith('blob:chrome-extension://') ||
            urlLower.startsWith('blob:moz-extension://')) {
            return false;
        }

        try {
            const path = new URL(url, window.location.href).pathname.toLowerCase();
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

    const detected = new Set();
    let reportTimeout = null;

    function report() {
        if (detected.size === 0) return;
        chrome.runtime.sendMessage({
            action: 'reportDetectedMedia',
            urls: Array.from(detected)
        });
    }

    window.mdu_scan = async function() {
        const result = await browser.storage.local.get(['detect-download-links', 'hide-segments', 'hide-page-components', 'only-image']);
        const detectDownloads = result['detect-download-links'] === '1' || result['detect-download-links'] === true;
        const initialSize = detected.size;
        const extraExts = detectDownloads ? downloadExtensions : [];

        const elements = document.querySelectorAll('video, audio, source, img, track, a, area, embed, iframe');
        for (const el of elements) {
            let url = el.src || el.href || el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-href') || el.getAttribute('data-original');
            if (el.tagName === 'SOURCE' || el.tagName === 'TRACK') {
                url = el.src || el.srcset;
            }
            if (url) {
                const absolute = getAbsoluteUrl(url);
                if (absolute) {
                    if (await checkIsSegment(absolute, result)) continue;
                    const isDownloadAttr = detectDownloads && el.tagName === 'A' && el.hasAttribute('download');
                    if (await isMediaUrl(absolute, extraExts, result) || el.tagName === 'VIDEO' || el.tagName === 'AUDIO' || isDownloadAttr) {
                        detected.add(absolute);
                    }
                }
            }
        }

        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            const bg = window.getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none') {
                const match = bg.match(/url\(['"]?([^'"]+)['"]?\)/);
                if (match && match[1]) {
                    const absolute = getAbsoluteUrl(match[1]);
                    if (absolute && await isMediaUrl(absolute, extraExts, result)) {
                        if (!(await checkIsSegment(absolute, result))) {
                            detected.add(absolute);
                        }
                    }
                }
            }

            for (let i = 0; i < el.attributes.length; i++) {
                const attr = el.attributes[i];
                const attrName = attr.name.toLowerCase();
                if ((attrName.startsWith('data-') || attrName === 'value' || attrName === 'action' || attrName === 'formaction') && await isMediaUrl(attr.value, extraExts, result)) {
                    const absolute = getAbsoluteUrl(attr.value);
                    if (absolute) {
                        if (!(await checkIsSegment(absolute, result))) {
                            detected.add(absolute);
                        }
                    }
                }
            }
        }

        if (detected.size > initialSize || initialSize === 0) {
            if (reportTimeout) clearTimeout(reportTimeout);
            reportTimeout = setTimeout(report, 500);
        }
    };

    window.mdu_scan();

    const observer = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldScan = true;
                break;
            }
        }
        if (shouldScan) {
            window.mdu_scan();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.mdu_detector_injected = true;
})();
