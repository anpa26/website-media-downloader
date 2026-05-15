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

    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp"];
    const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif"];
    const downloadExtensions = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];
    const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions, subtitleExtensions, imageExtensions);

    function isMediaUrl(url, extraExtensions = []) {
        if (!url || typeof url !== 'string') return false;
        const urlLower = url.toLowerCase();

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

    window.mdu_scan = function() {
        chrome.storage.local.get('detect-download-links', (result) => {
            const detectDownloads = result['detect-download-links'] === '1' || result['detect-download-links'] === true;
            const initialSize = detected.size;
            const extraExts = detectDownloads ? downloadExtensions : [];

            document.querySelectorAll('video, audio, source, img, track, a, area, embed, iframe').forEach(el => {
                let url = el.src || el.href || el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-href') || el.getAttribute('data-original');
                if (el.tagName === 'SOURCE' || el.tagName === 'TRACK') {
                    url = el.src || el.srcset;
                }
                if (url) {
                    const absolute = getAbsoluteUrl(url);
                    if (absolute) {
                        const isDownloadAttr = detectDownloads && el.tagName === 'A' && el.hasAttribute('download');
                        if (isMediaUrl(absolute, extraExts) || el.tagName === 'VIDEO' || el.tagName === 'AUDIO' || isDownloadAttr) {
                            detected.add(absolute);
                        }
                    }
                }
            });

            document.querySelectorAll('*').forEach(el => {
                const bg = window.getComputedStyle(el).backgroundImage;
                if (bg && bg !== 'none') {
                    const match = bg.match(/url\(['"]?([^'"]+)['"]?\)/);
                    if (match && match[1]) {
                        const absolute = getAbsoluteUrl(match[1]);
                        if (absolute && isMediaUrl(absolute, extraExts)) {
                            detected.add(absolute);
                        }
                    }
                }

                for (let i = 0; i < el.attributes.length; i++) {
                    const attr = el.attributes[i];
                    const attrName = attr.name.toLowerCase();
                    if ((attrName.startsWith('data-') || attrName === 'value' || attrName === 'action' || attrName === 'formaction') && isMediaUrl(attr.value, extraExts)) {
                        const absolute = getAbsoluteUrl(attr.value);
                        if (absolute) detected.add(absolute);
                    }
                }
            });

            if (detected.size > initialSize || initialSize === 0) {
                if (reportTimeout) clearTimeout(reportTimeout);
                reportTimeout = setTimeout(report, 500);
            }
        });
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
