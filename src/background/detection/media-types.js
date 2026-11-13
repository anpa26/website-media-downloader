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
const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions, subtitleExtensions, imageExtensions);

const extPattern = allExtensions.map(e => e.replace(/^\./, '').replace(/\+/g, '\\+')).join('|');
const detectionRegex = new RegExp('\\.(?:' + extPattern + ')\\b', 'i');
const temporaryHeaderMap = new Map();
const temporaryRequestBodyMap = new Map();
const temporaryCookieMap = new Map();
const urlToHeaderMap = new Map();
const HEADER_TTL_MS = 30 * 60 * 1000;

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


    const subtitleExtensions = [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"];
    const imageExtensions = [".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif", ".bmp", ".ico", ".tiff", ".tif"];
    const downloadExtensions = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

    const urlPath = urlLower.split('?')[0].split('#')[0];
    const hasExt = (ext) => urlPath.endsWith(ext);
    let decodedUrlLower = urlLower;
    try { decodedUrlLower = decodeURIComponent(urlLower); } catch (_) {}
    const isStaticNonStream = imageExtensions.some(hasExt) || subtitleExtensions.some(hasExt) || downloadExtensions.some(hasExt) ||
        mimeLower.startsWith('image/') || mimeLower.includes('vtt') || mimeLower.includes('subrip') || mimeLower.includes('ass');
    const streamUrlHint = !isStaticNonStream && (
        streamExtensions.some(hasExt) || hasExt('.m3u') ||
        /[?&](?:format|type|output|protocol)=(?:m3u8?|mpd|hls|dash)(?:[&#]|$)/i.test(decodedUrlLower) ||
        /(?:^|[/_.-])(?:master|playlist|manifest)(?:[/?#_.-]|$)/i.test(decodedUrlLower)
    );

    if (streamUrlHint || mimeLower.includes('mpegurl') || mimeLower.includes('dash+xml') || urlLower.includes('#stream')) return 'stream';
    if (videoExtensions.some(hasExt) || mimeLower.startsWith('video/') || urlLower.includes('mime=video') || urlLower.includes('#video')) return 'video';
    if (audioExtensions.some(hasExt) || mimeLower.startsWith('audio/') || urlLower.includes('mime=audio') || urlLower.includes('#audio')) return 'audio';

    if (mimeLower === 'image/svg+xml' || hasExt('.svg')) return null;
    if (mimeLower.startsWith('image/') || imageExtensions.some(hasExt) || urlLower.includes('#image')) return 'image';
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



    if (urlLower.includes('googlevideo.com/videoplayback')) {
        return true;
    }

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

    if (path.endsWith('.m4s')) return true;
    const isSegmentLikeExt = path.endsWith('.ts') || path.endsWith('.m4v') || path.endsWith('.m2ts') || path.endsWith('.mts');
    const hasSegmentKeyword = urlLower.includes('chunk') || urlLower.includes('fragment') || urlLower.includes('segment') || urlLower.includes('range/') || urlLower.includes('seg-');

    if (mimeLower === 'video/mp2t' ||
        mimeLower === 'video/iso.segment' ||
        mimeLower === 'audio/iso.segment') {
        return true;
    }

    if (isSegmentLikeExt) return size > 0 && size < 5242880 && hasSegmentKeyword;

    return false;
}
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
