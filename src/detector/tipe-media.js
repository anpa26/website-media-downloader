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

    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"];
    const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif", ".bmp", ".ico", ".tiff", ".tif"];
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

        if (path.endsWith('.m4s')) return true;
        const hasSegmentKeyword = urlLower.includes('chunk') || urlLower.includes('fragment') || urlLower.includes('segment') || urlLower.includes('range/') || urlLower.includes('seg-');
        return hasSegmentKeyword && (path.endsWith('.ts') || path.endsWith('.m4v') || path.endsWith('.m2ts') || path.endsWith('.mts'));
    }

    function getUrlType(url) {
        if (!url || typeof url !== 'string') return null;
        const urlLower = url.toLowerCase();

        if (urlLower.includes('mime=video') || urlLower.includes('#video')) return 'video';
        if (urlLower.includes('mime=audio') || urlLower.includes('#audio')) return 'audio';

        const urlPath = urlLower.split('?')[0].split('#')[0];
        const hasExt = (ext) => urlPath.endsWith(ext);

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
            if (type) return true;

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
