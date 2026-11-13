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



function updatePausePlayUI(btn, isPaused) {
  if (isPaused) {
    btn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></mdui-icon>${(browser?.i18n?.getMessage?.("resumeActiveButton") || chrome?.i18n?.getMessage?.("resumeActiveButton")) || "Resume"}`;
    btn.classList.add('is-paused');
    btn.classList.remove('is-playing');
  } else {
    btn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></mdui-icon>${(browser?.i18n?.getMessage?.("pauseButton") || chrome?.i18n?.getMessage?.("pauseButton")) || "Pause"}`;
    btn.classList.add('is-playing');
    btn.classList.remove('is-paused');
  }
}

function getMediaType(url, responseHeaders) {
    if (!url) return null;
    const urlLower = url.toLowerCase();

    let contentType = "";
    if (responseHeaders && Array.isArray(responseHeaders)) {
        const found = responseHeaders.find(h => h.name && h.name.toLowerCase() === "content-type");
        if (found && found.value) {
            contentType = found.value.toLowerCase();
        }
    }

    if (urlLower.startsWith('chrome-extension://') ||
        urlLower.startsWith('moz-extension://') ||
        urlLower.startsWith('blob:chrome-extension://') ||
        urlLower.startsWith('blob:moz-extension://')) {
        return null;
    }


    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"];
    const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif", ".bmp", ".ico", ".tiff", ".tif"];
    const downloadExtensions = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

    const urlPath = urlLower.split('?')[0].split('#')[0];
    const hasExt = (ext) => urlPath.endsWith(ext);
    let decodedUrlLower = urlLower;
    try { decodedUrlLower = decodeURIComponent(urlLower); } catch (_) {}
    const isStaticNonStream = imageExtensions.some(hasExt) || subtitleExtensions.some(hasExt) || downloadExtensions.some(hasExt) ||
        contentType.startsWith('image/') || contentType.includes('vtt') || contentType.includes('subrip') || contentType.includes('ass');
    const streamUrlHint = !isStaticNonStream && (
        streamExtensions.some(hasExt) || hasExt('.m3u') ||
        /[?&](?:format|type|output|protocol)=(?:m3u8?|mpd|hls|dash)(?:[&#]|$)/i.test(decodedUrlLower) ||
        /(?:^|[/_.-])(?:master|playlist|manifest)(?:[/?#_.-]|$)/i.test(decodedUrlLower)
    );

    if (streamUrlHint || contentType.includes('mpegurl') || contentType.includes('dash+xml') || urlLower.includes('#stream')) return 'stream';
    if (videoExtensions.some(hasExt) || contentType.startsWith('video/') || urlLower.includes('mime=video') || urlLower.includes('#video')) return 'video';
    if (audioExtensions.some(hasExt) || contentType.startsWith('audio/') || urlLower.includes('mime=audio') || urlLower.includes('#audio')) return 'audio';

    if (contentType === 'image/svg+xml' || hasExt('.svg')) return null;
    if (contentType.startsWith('image/') || imageExtensions.some(hasExt) || urlLower.includes('#image')) return 'image';
    if (subtitleExtensions.some(hasExt) || contentType.includes('vtt') || contentType.includes('subrip') || contentType.includes('ass') || contentType.includes('ttml') || contentType.includes('dfxp') || contentType.includes('sami') || contentType.includes('smil') || contentType.includes('lrc') || contentType.includes('sbv') || contentType.includes('microdvd') || urlLower.includes('#subtitle')) return 'subtitle';

    if (downloadExtensions.some(hasExt) || urlLower.includes('#file')) return 'file';

    return null;
}

function checkIsSegment(url, responseHeaders, settings) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    const contentType = responseHeaders?.find(h => h.name.toLowerCase() === "content-type")?.value?.toLowerCase() || "";
    const contentLength = responseHeaders?.find(h => h.name.toLowerCase() === "content-length")?.value || "0";
    const size = parseInt(contentLength) || 0;

    const isHideSegments = settings ? isFlagEnabled(settings['hide-segments'], true) : true;
    const isHidePageComponents = settings ? isFlagEnabled(settings['hide-page-components'], true) : true;

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

        if (settings && settings['only-image'] === '1' && (path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.webp') || path.endsWith('.png'))) {
            return false;
        }
        return true;
    }

    if (!isHideSegments) return false;

    if (path.endsWith('.m4s')) return true;
    const isSegmentLikeExt = path.endsWith('.ts') || path.endsWith('.m4v') || path.endsWith('.m2ts') || path.endsWith('.mts');
    const hasSegmentKeyword = urlLower.includes('chunk') || urlLower.includes('fragment') || urlLower.includes('segment') || urlLower.includes('range/') || urlLower.includes('seg-');

    if (contentType === 'video/mp2t' ||
        contentType === 'video/iso.segment' ||
        contentType === 'audio/iso.segment') {
        return true;
    }

    if (isSegmentLikeExt) return size > 0 && size < 5242880 && hasSegmentKeyword;

    return false;
}
