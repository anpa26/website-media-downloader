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

var mediaFilename = (() => {
    const extensions = new Set('mp4 m4v mkv webm mov avi flv ts m2ts mpg mpeg ogv 3gp mp3 m4a aac wav flac ogg opus wma aiff alac m3u8 mpd f4m ism isml jpg jpeg png gif webp avif svg bmp ico tif tiff vtt srt ass ssa ttml dfxp zip rar 7z tar gz bz2 xz pdf epub doc docx xls xlsx ppt pptx txt csv json xml apk exe msi dmg iso bin wasm'.split(' '));
    const mimeExtensions = {
        'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
        'video/quicktime': 'mov', 'video/mp2t': 'ts', 'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
        'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
        'application/vnd.apple.mpegurl': 'm3u8', 'application/x-mpegurl': 'm3u8',
        'application/dash+xml': 'mpd', 'image/jpeg': 'jpg', 'image/png': 'png',
        'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
        'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'application/zip': 'zip',
        'text/vtt': 'vtt', 'application/x-subrip': 'srt'
    };
    function decode(value) {
        try { return decodeURIComponent(value); } catch (_) { return value; }
    }
    function split(name) {
        const match = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
        if (!match || !extensions.has(match[1].toLowerCase())) return { stem: String(name || ''), ext: '' };
        return { stem: name.slice(0, -match[0].length), ext: match[0] };
    }
    function clean(name) {
        let result = String(name || '').normalize('NFC')
            .replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_')
            .replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
        if (!result) result = 'Media';
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = '_' + result;
        const { stem, ext } = split(result);
        const chars = Array.from(stem);
        const encoder = new TextEncoder();
        while (encoder.encode(chars.join('') + ext).length > 200 && chars.length) chars.pop();
        return chars.join('').replace(/[. ]+$/g, '') + ext;
    }
    function dispositionName(value) {
        const extended = /(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(value || '');
        if (extended) {
            const raw = (extended[1] || extended[2]).trim();
            const encoded = /^UTF-8'[^']*'(.*)$/i.exec(raw);
            if (encoded) {
                try { return decodeURIComponent(encoded[1]); } catch (_) {}
            }
        }
        const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]*))/i.exec(value || '');
        return plain ? (plain[1] || plain[2] || '').replace(/\\(["\\])/g, '$1').trim() : '';
    }
    function generic(name) {
        const stem = split(name).stem;
        return !stem || /^(?:index|master|playlist|manifest|video|audio|stream|download|file|media|videoplayback)(?:[-_ ]?\d+)?$/i.test(stem)
            || /\.(?:php|aspx?|jsp|cgi)$/i.test(name)
            || /^[a-f0-9-]{16,}$/i.test(stem) || /^\d{6,}$/.test(stem)
            || (stem.length >= 32 && /^[a-z0-9_-]+$/i.test(stem) && /\d/.test(stem));
    }
    function resolve(url, metadata = {}) {
        let parsed;
        try { parsed = new URL(url); } catch (_) {}
        const headers = metadata.responseHeaders || [];
        const header = name => headers.find(h => h.name?.toLowerCase() === name)?.value || '';
        const serverName = dispositionName(header('content-disposition')) ||
            dispositionName(parsed?.searchParams.get('response-content-disposition'));
        let queryName = '';
        for (const key of ['filename', 'file_name', 'download', 'name']) {
            const candidate = parsed?.searchParams.get(key);
            if (candidate && split(candidate).ext) { queryName = candidate; break; }
        }
        const pathName = decode(parsed?.pathname.split('/').pop() || '');
        const hashName = /#(?:video|audio)\.([a-z0-9]+)$/i.exec(url || '');
        const mime = (header('content-type') || metadata.contentType || parsed?.searchParams.get('mime') || '').split(';')[0].trim().toLowerCase();
        const ext = split(serverName).ext || split(queryName).ext ||
            (hashName && extensions.has(hashName[1].toLowerCase()) ? '.' + hashName[1].toLowerCase() : '') ||
            split(pathName).ext || (mimeExtensions[mime] ? '.' + mimeExtensions[mime] : '');
        const title = String(metadata.title || metadata.pageTitle || '').trim();
        let name = serverName || queryName || (!generic(pathName) ? pathName : '') || title || pathName || 'Media';
        name = clean(name);
        if (ext && !split(name).ext) name += ext;
        return clean(name);
    }
    function changeExtension(name, ext) {
        return clean(split(name).stem + ext);
    }
    function template(pattern, url, originalName, title) {
        let host = '';
        try { host = new URL(url).hostname; } catch (_) {}
        const now = new Date();
        const { stem, ext } = split(originalName);
        const values = {
            name: stem, title: title || stem, host,
            date: [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'),
            time: [now.getHours(), now.getMinutes(), now.getSeconds()].map(v => String(v).padStart(2, '0')).join('-')
        };
        let result = (pattern || '{name}').replace(/\{(name|title|host|date|time)\}/g, (_, key) => values[key]);
        if (ext && !result.toLowerCase().endsWith(ext.toLowerCase())) result += ext;
        return clean(result);
    }
    return { resolve, template, clean, changeExtension };
})();
