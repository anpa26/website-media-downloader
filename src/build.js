#!/usr/bin/env node

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

/*
    Build script for Website Media Downloader
    Builds separate Chrome and Firefox extension packages from shared source.

    Usage:
        node src/build.js chrome      - Build Chrome extension
        node src/build.js firefox     - Build Firefox extension
        node src/build.js firefox-amo - Build Firefox extension for AMO listed distribution (no update_url)
        node src/build.js firefox-light-amo - Build Firefox Light extension for AMO listed distribution (no update_url)
        node src/build.js light       - Build all Light editions
        node src/build.js chrome-light|chrome-yt-light|firefox-light
        node src/build.js debug       - Build all Debug editions
        node src/build.js <target>-debug
        node src/build.js all         - Build all targets including Debug (default)
        node src/build.js clean       - Remove build outputs
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = __dirname;
const OVERRIDES_DIR = path.join(SRC_DIR, 'overrides');
const BUILD_DIR = path.join(ROOT, 'build');

const EXCLUDE_FROM_BUILD = new Set(['build.js', 'overrides', 'minify.js', 'light_mediabunny_mux.js', 'light_mediabunny_subtitles.js', 'light_mediabunny_worker.js']);

const MEDIABUNNY_FILES = ['mediabunny.min.js', 'MEDIABUNNY-LICENSE.txt'];
const LIGHT_MP3_FILES = ['lame.min.js', 'mp3_worker.js'];
const LIGHT_STREAM_CONVERSION_FILES = ['mux.js', 'mp4_duration.js'];

const FIREFOX_EXCLUDES = new Set(['chrome_audio_jobs.js', 'offscreen.html', 'offscreen.js']);
const BERKAS_KHUSUS_YOUTUBE = ['yt_core.js', 'wymd.js', 'youtube-mux.js', 'youtube-chunk.js', 'youtube-vtt.js', 'youtube-subtitle.js'];
const BERKAS_KHUSUS_FIREFOX = ['audio-base.js', 'cache.js'];
const BERKAS_KHUSUS_CHROME = ['ts-converter.js'];
const BERKAS_CADANGAN_FIREFOX = ['download_recovery.js', 'audio_processor.html'];
const BERKAS_RINGAN_BERSAMA = ['libav.js', ...LIGHT_MP3_FILES, ...LIGHT_STREAM_CONVERSION_FILES];

const FIREFOX_BASED_TARGETS = new Set(['firefox', 'firefox-amo', 'firefox-light', 'firefox-light-amo']);
const TARGET_AMO = new Set(['firefox-amo', 'firefox-light-amo']);

const EXCLUDE_PER_TARGET = {
    chrome: new Set([...BERKAS_KHUSUS_YOUTUBE, ...BERKAS_KHUSUS_FIREFOX, ...BERKAS_KHUSUS_CHROME, ...MEDIABUNNY_FILES]),
    'chrome-yt': new Set([...BERKAS_KHUSUS_FIREFOX, ...MEDIABUNNY_FILES]),
    firefox: new Set([...FIREFOX_EXCLUDES, ...MEDIABUNNY_FILES]),
    'chrome-light': new Set([...BERKAS_KHUSUS_YOUTUBE, ...BERKAS_KHUSUS_FIREFOX, ...BERKAS_KHUSUS_CHROME, ...BERKAS_CADANGAN_FIREFOX, ...BERKAS_RINGAN_BERSAMA]),
    'chrome-yt-light': new Set([...BERKAS_KHUSUS_FIREFOX, ...BERKAS_CADANGAN_FIREFOX, ...BERKAS_RINGAN_BERSAMA]),
    'firefox-light': new Set([...FIREFOX_EXCLUDES, ...BERKAS_RINGAN_BERSAMA]),
};
EXCLUDE_PER_TARGET['firefox-amo'] = new Set(EXCLUDE_PER_TARGET.firefox);
EXCLUDE_PER_TARGET['firefox-light-amo'] = new Set(EXCLUDE_PER_TARGET['firefox-light']);

const FIREFOX_DEBUG_IDS = {
    firefox: '{1376a6d2-e07f-4015-af28-ca2acfef4e37}',
    'firefox-light': '{d223cfe1-7d70-4ba2-a81c-3cc817d21cc7}'
};
const CHROME_LIGHT_TARGETS = new Set(['chrome-light', 'chrome-yt-light']);
const LIGHT_TARGETS = new Set(['chrome-light', 'chrome-yt-light', 'firefox-light', 'firefox-light-amo']);
const BASE_TARGETS = ['chrome', 'chrome-yt', 'firefox', 'firefox-amo', 'chrome-light', 'chrome-yt-light', 'firefox-light', 'firefox-light-amo'];
const DEBUG_TARGETS = BASE_TARGETS.filter(target => !target.endsWith('-amo')).map(target => `${target}-debug`);
const DEBUG_MESSAGE_KEYS = [
    'debugLogTitle',
    'debugLogExplain',
    'downloadDebugLogButton',
    'clearDebugLogButton',
    'debugLogEntriesStatus',
    'debugLogDownloaded',
    'debugLogDownloadError',
    'debugLogCleared'
];
const OVERRIDE_CHAIN_PER_TARGET = {
    'chrome-light': ['chrome', 'light'],
    'chrome-yt-light': ['chrome-yt', 'light'],
    'firefox-light': ['light', 'firefox-light'],
    'firefox-light-amo': ['light', 'firefox-light']
};
const LIGHT_SPEED_TEST_MESSAGES = [
    'settingsSpeedTestSectionTitle',
    'speedTestIntro',
    'runSpeedTestBtn',
    'downloadNormal',
    'downloadSpeedBoost',
    'uploadNormal',
    'uploadSpeedBoost',
    'downloadSpeed',
    'uploadSpeed',
    'speedTestStatusTestingDownload',
    'speedTestStatusTestingUpload',
    'speedTestStatusCompleted',
    'speedTestStatusFailed'
];
const LIGHT_DEVICE_NOTIFICATION_MESSAGES = [
    'mediaSystemNotificationCheckbox',
    'mediaSystemNotificationExplain',
    'fetchNotificationTitle',
    'fetchNotificationExplain'
];
const LIGHT_DEAD_MESSAGES = [
    'historyLinkUpdated',
    'streamDownloadCompleteTitle',
    'streamDownloadSaved'
];
const LIGHT_DEAD_MESSAGE_PATTERN = /^(?:qualityModal|ytModal)/i;
const LIGHT_CLOUD_SETTING_KEYS = [
    'save-to-gdrive',
    'gdrive-stream',
    'gdrive_token',
    'gdrive_user',
    'save-to-dropbox',
    'dropbox-stream',
    'dropbox_token',
    'dropbox_user'
];

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function copyRecursive(src, dest, excludeSet = new Set()) {
    const name = path.basename(src);
    if (excludeSet.has(name)) return;

    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child), excludeSet);
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

/**
 * Deep-merge override JSON into an existing JSON file.
 * Only top-level keys from the override replace keys in the base.
 */
function mergeJsonFile(basePath, overridePath) {
    const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
    const override = JSON.parse(fs.readFileSync(overridePath, 'utf8'));

    for (const key of Object.keys(override)) {
        if (override[key] === null) {
            delete base[key];
        } else {
            base[key] = override[key];
        }
    }

    fs.writeFileSync(basePath, JSON.stringify(base, null, 4) + '\n', 'utf8');
}

/**
 * Apply browser-specific overrides from overrides/<target>/ onto the build.
 * - JSON files are merged at the top-level key level
 * - Non-JSON files fully replace the base
 */
function applyOverrides(target, outDir, excludeSet = new Set()) {
    const overrideTargets = OVERRIDE_CHAIN_PER_TARGET[target] || [target];
    for (const overrideTarget of overrideTargets) {
        const overrideDir = path.join(OVERRIDES_DIR, overrideTarget);
        if (fs.existsSync(overrideDir)) applyOverridesRecursive(overrideDir, outDir, excludeSet);
    }
}

function applyOverridesRecursive(overrideDir, outDir, excludeSet = new Set()) {
    for (const entry of fs.readdirSync(overrideDir)) {
        const overridePath = path.join(overrideDir, entry);
        const destPath = path.join(outDir, entry);
        const stat = fs.statSync(overridePath);

        if (stat.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            applyOverridesRecursive(overridePath, destPath, excludeSet);
        } else if (excludeSet.has(entry)) {
            continue;
        } else if (entry.endsWith('.json') && fs.existsSync(destPath)) {
            mergeJsonFile(destPath, overridePath);
        } else {
            fs.copyFileSync(overridePath, destPath);
        }
    }
}

/**
 * Count the number of override files for a given target.
 */
function countOverrideFiles(target) {
    let count = 0;
    for (const overrideTarget of OVERRIDE_CHAIN_PER_TARGET[target] || [target]) {
        const overrideDir = path.join(OVERRIDES_DIR, overrideTarget);
        if (!fs.existsSync(overrideDir)) continue;
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir)) {
                const p = path.join(dir, e);
                if (fs.statSync(p).isDirectory()) walk(p);
                else count++;
            }
        };
        walk(overrideDir);
    }
    return count;
}

function removeMarkedSections(filePath, feature) {
    const startMarker = `LIGHT_EXCLUDE_${feature}_START`;
    const endMarker = `LIGHT_EXCLUDE_${feature}_END`;
    let content = fs.readFileSync(filePath, 'utf8');
    let removed = 0;

    while (content.includes(startMarker)) {
        const start = content.lastIndexOf('\n', content.indexOf(startMarker)) + 1;
        const endMarkerIndex = content.indexOf(endMarker, start);
        if (endMarkerIndex === -1) {
            throw new Error(`[light] Missing ${endMarker} in ${path.relative(SRC_DIR, filePath)}`);
        }
        const endLine = content.indexOf('\n', endMarkerIndex);
        content = content.slice(0, start) + content.slice(endLine === -1 ? content.length : endLine + 1);
        removed++;
    }

    if (removed === 0) {
        throw new Error(`[light] Missing ${startMarker} in ${path.relative(SRC_DIR, filePath)}`);
    }
    fs.writeFileSync(filePath, content, 'utf8');
}

function findMatchingBrace(source, openBrace) {
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let i = openBrace; i < source.length; i++) {
        const char = source[i];
        const next = source[i + 1];
        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') { blockComment = false; i++; }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === '/' && next === '/') { lineComment = true; i++; continue; }
        if (char === '/' && next === '*') { blockComment = true; i++; continue; }
        if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
        if (char === '{') depth++;
        if (char === '}' && --depth === 0) return i;
    }
    throw new Error('Unmatched brace while stripping Light-only code');
}

function replaceNamedFunction(source, functionName, replacement) {
    const signature = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
    const match = signature.exec(source);
    if (!match) return { source, replaced: false };
    const start = match.index;
    const openBrace = source.indexOf('{', start + match[0].length);
    const end = findMatchingBrace(source, openBrace);
    return { source: source.slice(0, start) + replacement.trim() + source.slice(end + 1), replaced: true };
}

function replaceFunctionBody(source, functionName, body) {
    const signature = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
    const match = signature.exec(source);
    if (!match) return { source, replaced: false };
    const openBrace = source.indexOf('{', match.index + match[0].length);
    const end = findMatchingBrace(source, openBrace);
    return {
        source: source.slice(0, openBrace + 1) + `\n    ${body}\n` + source.slice(end),
        replaced: true
    };
}

function stripDisabledFunctionBodies(filePath, replacements) {
    if (!fs.existsSync(filePath)) return;
    let source = fs.readFileSync(filePath, 'utf8');
    // Work from the bottom of the file upward. This also keeps an unusual
    // regular-expression literal in one function from affecting the parser
    // position of declarations that follow it.
    for (const [functionName, body] of Object.entries(replacements).reverse()) {
        let result;
        try {
            result = replaceFunctionBody(source, functionName, body);
        } catch (error) {
            throw new Error(`[light] Could not strip ${functionName} in ${path.relative(SRC_DIR, filePath)}: ${error.message}`);
        }
        if (!result.replaced) {
            throw new Error(`[light] Missing function ${functionName} in ${path.relative(SRC_DIR, filePath)}`);
        }
        source = result.source;
    }
    fs.writeFileSync(filePath, source, 'utf8');
}

function replaceSection(filePath, startText, endText, replacement) {
    let source = fs.readFileSync(filePath, 'utf8');
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start + startText.length);
    if (start === -1 || end === -1) {
        throw new Error(`[light] Missing section boundary in ${path.relative(SRC_DIR, filePath)}`);
    }
    source = source.slice(0, start) + replacement.trim() + '\n\n' + source.slice(end);
    fs.writeFileSync(filePath, source, 'utf8');
}

function gantiSeksiNgantiAkhir(filePath, startText, replacement) {
    let source = fs.readFileSync(filePath, 'utf8');
    const start = source.indexOf(startText);
    if (start === -1) {
        throw new Error(`[light] Missing section boundary in ${path.relative(SRC_DIR, filePath)}`);
    }
    source = source.slice(0, start) + replacement.trim() + '\n';
    fs.writeFileSync(filePath, source, 'utf8');
}

const URUTAN_MODUL_LATAR = [
    'boot.js', 'detection/m3u8-youtube.js', 'jobs/persistent-jobs.js', 'cache/cache-db.js', 'detection/media-types.js',
    'detection/headers.js', 'settings.js', 'ui/toast.js', 'ui/notifikasi.js', 'jobs/history.js', 'jobs/autodownload.js',
    'detection/listeners.js', 'audio/audio.js', 'audio/audio-base.js', 'router.js', 'download/zip.js',
    'download/fetch-core.js', 'cloud/cloud-upload.js', 'cloud/cloud-save.js', 'cloud/cloud-paralel.js', 'cloud/cloud-auth.js', 'cloud/cloud-stream.js', 'download/fetch-download.js', 'init.js', 'cache/cache.js'
];

function dhaftarJsRekursif(dir, awalan = '') {
    const hasil = [];
    for (const entri of fs.readdirSync(dir, { withFileTypes: true })) {
        const relatif = awalan ? awalan + '/' + entri.name : entri.name;
        if (entri.isDirectory()) hasil.push(...dhaftarJsRekursif(path.join(dir, entri.name), relatif));
        else if (entri.name.endsWith('.js')) hasil.push(relatif);
    }
    return hasil.sort();
}

function daftarBerkasLatar(outDir) {
    const daftar = [path.join(outDir, 'network_detector.js')];
    const latarDir = path.join(outDir, 'background');
    if (fs.existsSync(latarDir)) {
        const ono = new Set(dhaftarJsRekursif(latarDir));
        for (const nama of URUTAN_MODUL_LATAR) {
            if (ono.has(nama)) {
                daftar.push(path.join(latarDir, ...nama.split('/')));
                ono.delete(nama);
            }
        }
        for (const nama of [...ono].sort()) daftar.push(path.join(latarDir, ...nama.split('/')));
    }
    return daftar;
}

function wocoGabunganLatar(outDir) {
    return daftarBerkasLatar(outDir).map(berkas => fs.readFileSync(berkas, 'utf8')).join('\n');
}

const URUTAN_MODUL_UNDUHAN = [
    'cache-db.js', 'cloud/cloud-auth.js', 'cloud/cloud-upload.js', 'nama-file.js',
    'unduhan.js', 'init.js'
];

function wocoGabunganUnduhan(outDir) {
    const daftar = [path.join(outDir, 'pages', 'download.js')];
    const unduhanDir = path.join(outDir, 'download');
    if (fs.existsSync(unduhanDir)) {
        const ono = new Set(dhaftarJsRekursif(unduhanDir));
        for (const nama of URUTAN_MODUL_UNDUHAN) {
            if (ono.has(nama)) {
                daftar.push(path.join(unduhanDir, ...nama.split('/')));
                ono.delete(nama);
            }
        }
        for (const nama of [...ono].sort()) daftar.push(path.join(unduhanDir, ...nama.split('/')));
    }
    return daftar.map(berkas => fs.readFileSync(berkas, 'utf8')).join('\n');
}

const URUTAN_MODUL_PENGATURAN = [
    'state.js', 'notif.js', 'tampilan/tema.js', 'perawatan/ekspor.js', 'perawatan/debug.js', 'perawatan/cache-indexeddb.js',
    'alat/ts-converter.js', 'tampilan/konfirmasi.js', 'pengaturan.js', 'tampilan/tata-letak.js',
    'alat/speedtest.js', 'boot.js'
];

function wocoGabunganPengaturan(outDir) {
    const daftar = [path.join(outDir, 'entries', 'settings.js')];
    const pengaturanDir = path.join(outDir, 'settings');
    if (fs.existsSync(pengaturanDir)) {
        const ono = new Set(dhaftarJsRekursif(pengaturanDir));
        for (const nama of URUTAN_MODUL_PENGATURAN) {
            if (ono.has(nama)) {
                daftar.push(path.join(pengaturanDir, ...nama.split('/')));
                ono.delete(nama);
            }
        }
        for (const nama of [...ono].sort()) daftar.push(path.join(pengaturanDir, ...nama.split('/')));
    }
    return daftar.map(berkas => fs.readFileSync(berkas, 'utf8')).join('\n');
}

const URUTAN_MODUL_KONVERTER = [
    'util.js', 'cache/cache-db.js', 'segmen.js', 'mux/transmux.js', 'spoof.js',
    'cache/cache-media.js', 'antrean.js', 'cloud/cloud-stream.js', 'cloud/cloud-auth.js', 'cloud/cloud-upload.js', 'media-types.js',
    'finalize.js', 'audio.js', 'm3u8/m3u8-varian.js', 'm3u8/m3u8-unduh.js', 'mux/gabung-mp4.js', 'mpd/mpd.js',
    'mpd/pilih-mpd.js', 'progress.js', 'youtube/youtube-mux.js', 'youtube/youtube-chunk.js', 'youtube/youtube-vtt.js', 'youtube/youtube-subtitle.js'
];

function wocoGabunganKonverter(outDir) {
    const daftar = [path.join(outDir, 'entries', 'offlineStreamConvert.js')];
    const konverterDir = path.join(outDir, 'converter');
    if (fs.existsSync(konverterDir)) {
        const ono = new Set(dhaftarJsRekursif(konverterDir));
        for (const nama of URUTAN_MODUL_KONVERTER) {
            if (ono.has(nama)) {
                daftar.push(path.join(konverterDir, ...nama.split('/')));
                ono.delete(nama);
            }
        }
        for (const nama of [...ono].sort()) daftar.push(path.join(konverterDir, ...nama.split('/')));
    }
    return daftar.map(berkas => fs.readFileSync(berkas, 'utf8')).join('\n');
}

function stripLibAvCode(outDir) {
    const muxReplacement = fs.readFileSync(path.join(SRC_DIR, 'workers', 'light_mediabunny_mux.js'), 'utf8');
    const subtitleReplacement = fs.readFileSync(path.join(SRC_DIR, 'workers', 'light_mediabunny_subtitles.js'), 'utf8');
    const youtubeMuxPath = path.join(outDir, 'converter', 'youtube', 'youtube-mux.js');
    const youtubeSubtitlePath = path.join(outDir, 'converter', 'youtube', 'youtube-subtitle.js');
    let muxResult = { replaced: false };
    if (fs.existsSync(youtubeMuxPath)) {
        let youtubeMux = fs.readFileSync(youtubeMuxPath, 'utf8');
        muxResult = replaceNamedFunction(youtubeMux, 'downloadAndMuxYoutube', muxReplacement);
        fs.writeFileSync(youtubeMuxPath, muxResult.source, 'utf8');
    }
    if (fs.existsSync(youtubeSubtitlePath)) {
        let youtubeSubtitle = fs.readFileSync(youtubeSubtitlePath, 'utf8');
        const subtitleResult = replaceNamedFunction(
            youtubeSubtitle,
            'embedSubtitlesWithLibAV',
            subtitleReplacement
        );
        fs.writeFileSync(youtubeSubtitlePath, subtitleResult.source, 'utf8');
    }

    const gabungPath = path.join(outDir, 'converter', 'mux', 'gabung-mp4.js');
    let gabung = fs.readFileSync(gabungPath, 'utf8');
    gabung = replaceNamedFunction(
        gabung,
        'gabungkanVideoAudioKeMp4',
        'async function gabungkanVideoAudioKeMp4() { throw new Error("Muxing is not available in the light edition."); }'
    ).source;
    fs.writeFileSync(gabungPath, gabung, 'utf8');

    fs.copyFileSync(
        path.join(SRC_DIR, 'workers', 'light_mediabunny_worker.js'),
        path.join(outDir, 'workers', 'light_mediabunny_worker.js')
    );

    const mpdPath = path.join(outDir, 'converter', 'mpd', 'mpd.js');
    let mpd = fs.readFileSync(mpdPath, 'utf8');
    const mpdFlag = 'if (mpdToMp4Enabled) {';
    const mpdStart = mpd.lastIndexOf(mpdFlag);
    if (mpdStart !== -1) {
        const openBrace = mpd.indexOf('{', mpdStart);
        const end = findMatchingBrace(mpd, openBrace);
        mpd = mpd.slice(0, mpdStart) + 'if (false) {}' + mpd.slice(end + 1);
    }
    fs.writeFileSync(mpdPath, mpd, 'utf8');

    const replaceLegacySubtitleCall = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) replaceLegacySubtitleCall(entryPath);
            else if (/\.js$/i.test(entry.name)) {
                const source = fs.readFileSync(entryPath, 'utf8');
                if (source.includes('embedSubtitlesWithLibAV') || source.includes('LibAV')) {
                    fs.writeFileSync(
                        entryPath,
                        source.replaceAll('embedSubtitlesWithLibAV', 'embedSubtitlesLight').replaceAll('LibAV', 'Light muxer'),
                        'utf8'
                    );
                }
            }
        }
    };
    replaceLegacySubtitleCall(outDir);

    const readmePath = path.join(outDir, 'README.md');
    if (fs.existsSync(readmePath)) {
        const readme = fs.readFileSync(readmePath, 'utf8');
        fs.writeFileSync(
            readmePath,
            readme.replace(
                /- Media Processing: \[libav\.js\]\([^\n]+\)/i,
                muxResult.replaced ? '- Media Processing: [Mediabunny](https://github.com/Vanilagy/mediabunny/)' : ''
            ),
            'utf8'
        );
    }

    if (!muxResult.replaced) {
        for (const file of MEDIABUNNY_FILES) {
            const unusedPath = path.join(outDir, 'libraries', file);
            if (fs.existsSync(unusedPath)) fs.unlinkSync(unusedPath);
        }
        return;
    }

    for (const htmlName of ['pages/popup.html', 'pages/audio_processor.html', 'pages/offscreen.html', 'pages/stream_processor.html']) {
        const htmlPath = path.join(outDir, htmlName);
        if (!fs.existsSync(htmlPath)) continue;
        let html = fs.readFileSync(htmlPath, 'utf8');
        if (!html.includes('entries/offlineStreamConvert.js')) continue;
        html = html.replace(
            /(<script\s+src=["']\.\.\/entries\/offlineStreamConvert\.js["']><\/script>)/,
            '<script src="../libraries/mediabunny.min.js"></script>\n$1'
        );
        fs.writeFileSync(htmlPath, html, 'utf8');
    }
}

function stripMp3Conversion(outDir) {
    const audioPath = path.join(outDir, 'converter', 'audio.js');
    let audio = fs.readFileSync(audioPath, 'utf8');
    audio = replaceNamedFunction(
        audio,
        'convertM4aToMp3Direct',
        `async function convertM4aToMp3Direct(blob, filename) {\n    return { blob, filename: filename.replace(/\\.mp3$/i, '.m4a') };\n}`
    ).source;
    audio = replaceNamedFunction(
        audio,
        'convertAudioToMp3IfEnabled',
        `async function convertAudioToMp3IfEnabled(blob, filename) {\n    return { blob, filename: filename.replace(/\\.mp3$/i, '.wav') };\n}`
    ).source;
    fs.writeFileSync(audioPath, audio, 'utf8');
}

function stripDisabledIntegrations(outDir) {
    const unavailable = `throw new Error('This integration is not available in the Light edition.');`;
    const stubKelasCloud = `class CloudUploadController { pause() {} resume() {} cancel() {} }`;
    const cloudStreamStubs = [
        'startDropboxStreamUpload', 'appendDropboxStream', 'finishDropboxStream',
        'startGDriveStreamUpload', 'uploadStreamChunk'
    ].map(name => `async function ${name}() { ${unavailable} }`).join('\n') + '\n' + stubKelasCloud;
    const cloudAuthStubs = [
        'reauthDropbox', 'reauthGDrive'
    ].map(name => `async function ${name}() { ${unavailable} }`).join('\n');
    const cloudUploadStubs = [
        'uploadToDropbox', 'uploadToGDrive', 'uploadChunks'
    ].map(name => `async function ${name}() { ${unavailable} }`).join('\n');
    const backgroundCloudStreamStubs = [
        'startDropboxStreamUpload', 'appendDropboxStream', 'finishDropboxStream',
        'startGDriveStreamUpload', 'uploadStreamChunk',
        'uploadToGDrive', 'uploadChunks'
    ].map(name => `async function ${name}() { ${unavailable} }`).join('\n') + '\n' + stubKelasCloud;
    const backgroundCloudAuthStubs = [
        'reauthDropbox', 'reauthGDrive'
    ].map(name => `async function ${name}() { ${unavailable} }`).join('\n');

    const konverterDir = path.join(outDir, 'converter');
    gantiSeksiNgantiAkhir(path.join(konverterDir, 'cloud', 'cloud-stream.js'), 'class CloudUploadController', cloudStreamStubs);
    gantiSeksiNgantiAkhir(path.join(konverterDir, 'cloud', 'cloud-auth.js'), 'async function reauthDropbox', cloudAuthStubs);
    gantiSeksiNgantiAkhir(path.join(konverterDir, 'cloud', 'cloud-upload.js'), 'function uploadToDropbox', cloudUploadStubs);
    replaceSection(
        path.join(konverterDir, 'm3u8', 'm3u8-unduh.js'),
        '    let transmuxer = null;',
        '    let nextUploadIndex = 0;',
        '    let transmuxer = null;\n    const transmuxedOutputQueue = [];'
    );
    stripDisabledFunctionBodies(path.join(konverterDir, 'mux', 'transmux.js'), {
        transmuxToMp4: unavailable
    });
    let utilKonverter = fs.readFileSync(path.join(konverterDir, 'util.js'), 'utf8');
    utilKonverter = utilKonverter.replace("const ensureMuxJsLoaded = () => ensureOptionalLibraryLoaded('libraries/mux.js', 'muxjs');\n", '');
    fs.writeFileSync(path.join(konverterDir, 'util.js'), utilKonverter, 'utf8');

    const latarDir = path.join(outDir, 'background');
    replaceSection(
        path.join(latarDir, 'cloud', 'cloud-upload.js'),
        'function uploadToDropbox',
        'async function assembleBlobFromCache',
        `async function uploadToDropbox() { ${unavailable} }\nasync function uploadFromCacheToDropbox() { ${unavailable} }\nasync function uploadFromCacheToGDrive() { ${unavailable} }`
    );
    gantiSeksiNgantiAkhir(path.join(latarDir, 'cloud', 'cloud-stream.js'), 'class CloudUploadController', backgroundCloudStreamStubs);
    gantiSeksiNgantiAkhir(path.join(latarDir, 'cloud', 'cloud-auth.js'), 'async function reauthDropbox', backgroundCloudAuthStubs);
    stripDisabledFunctionBodies(path.join(latarDir, 'jobs', 'autodownload.js'), {
        maybeAutoDownloadMedia: 'return false;',
        scheduleExistingMediaAutoDownload: 'return;'
    });

    const stubAuthUnduhan = ['reauthDropbox', 'reauthGDrive']
        .map(name => `async function ${name}() { ${unavailable} }`).join('\n');
    const stubUnggahUnduhan = [
        'startDropboxStreamUpload', 'appendDropboxStream', 'finishDropboxStream',
        'startGDriveStreamUpload', 'uploadStreamChunk',
        'uploadToDropbox', 'uploadToGDrive', 'uploadChunks'
    ].map(name => `async function ${name}() { ${unavailable} }`).join('\n') + '\n' + stubKelasCloud;
    const tulisStubUnduhan = (namaModul, stub) => {
        const berkasModul = path.join(outDir, 'download', namaModul);
        const isiLawas = fs.readFileSync(berkasModul, 'utf8');
        const header = isiLawas.split('\n').slice(0, 19).join('\n');
        fs.writeFileSync(berkasModul, `${header}\n${stub}\n`, 'utf8');
    };
    tulisStubUnduhan('cloud/cloud-auth.js', stubAuthUnduhan);
    tulisStubUnduhan('cloud/cloud-upload.js', stubUnggahUnduhan);
    replaceSection(
        path.join(outDir, 'settings', 'pengaturan.js'),
        "    const gdriveBtn = document.getElementById('gdrive-login-btn');\n    const gdriveText = document.getElementById('gdrive-login-text');",
        "    const layoutResult = await browser.storage.local.get('settings-layout');",
        ''
    );

    const removeIfPresent = (filePath, functionNames) => {
        let source = fs.readFileSync(filePath, 'utf8');
        for (const functionName of functionNames) {
            const gabungan = wocoGabunganLatar(outDir);
            const occurrences = gabungan.match(new RegExp(`\\b${functionName}\\b`, 'g'))?.length || 0;
            if (occurrences !== 1) continue;
            const hasil = replaceNamedFunction(source, functionName, '');
            if (!hasil.replaced) continue;
            source = hasil.source;
        }
        fs.writeFileSync(filePath, source, 'utf8');
    };
    removeIfPresent(path.join(latarDir, 'detection', 'm3u8-youtube.js'), ['getM3U8VariantsBg']);
    removeIfPresent(path.join(latarDir, 'settings.js'), ['restoreActiveDownloadsFromSession']);
    removeIfPresent(path.join(latarDir, 'ui', 'notifikasi.js'), ['injectNotificationScript']);
    removeIfPresent(path.join(latarDir, 'ui', 'toast.js'), ['showSimpleToast']);
    removeIfPresent(path.join(latarDir, 'jobs', 'history.js'), ['autoUpdateHistoryLink']);
    removeIfPresent(path.join(latarDir, 'jobs', 'autodownload.js'), ['normalizeAutoDownloadDomain']);
    removeIfPresent(path.join(latarDir, 'cloud', 'cloud-upload.js'), ['assembleBlobFromCache']);
}

function stripLightFeatures(outDir) {
    const popupPath = path.join(outDir, 'pages', 'popup.html');
    removeMarkedSections(popupPath, 'SPEED_TEST');
    removeMarkedSections(popupPath, 'CLOUD_SETTINGS');
    removeMarkedSections(popupPath, 'DEVICE_NOTIFICATIONS');
    removeMarkedSections(popupPath, 'AUTO_DOWNLOAD');
    removeMarkedSections(popupPath, 'MEDIA_PROCESSING_OPTIONS');
    removeMarkedSections(popupPath, 'STREAM_MP4');
    removeMarkedSections(popupPath, 'MP3_CONVERSION');
    const popup = fs.readFileSync(popupPath, 'utf8').replace(
        /\s*<div class="settings-items-container">\s*<\/div>/g,
        ''
    );
    fs.writeFileSync(popupPath, popup, 'utf8');
    removeMarkedSections(path.join(outDir, 'settings', 'boot.js'), 'SPEED_TEST');
    removeMarkedSections(path.join(outDir, 'settings', 'alat', 'speedtest.js'), 'SPEED_TEST');
    stripLibAvCode(outDir);
    stripMp3Conversion(outDir);
    stripDisabledIntegrations(outDir);

    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const workerResources = ['workers/light_mediabunny_worker.js', 'libraries/mediabunny.min.js'];
    manifest.web_accessible_resources = manifest.web_accessible_resources || [];
    for (const entry of manifest.web_accessible_resources) {
        if (Array.isArray(entry.resources)) {
            entry.resources = entry.resources.filter(resource => fs.existsSync(path.join(outDir, resource)));
        }
    }
    const workerResourceEntry = manifest.web_accessible_resources.find(entry =>
        Array.isArray(entry.resources) && entry.resources.includes('light_mediabunny_worker.js')
    );
    if (workerResourceEntry) {
        workerResourceEntry.resources = Array.from(new Set([...workerResourceEntry.resources, ...workerResources]));
    } else {
        manifest.web_accessible_resources.push({ resources: workerResources, matches: ['<all_urls>'] });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n', 'utf8');

    const backgroundPath = path.join(outDir, 'network_detector.js');
    const background = fs.readFileSync(backgroundPath, 'utf8');
    const disabledCloudSettings = Object.fromEntries(
        LIGHT_CLOUD_SETTING_KEYS.filter(key => !key.endsWith('_token') && !key.endsWith('_user')).map(key => [key, '0'])
    );
    const cloudTokens = LIGHT_CLOUD_SETTING_KEYS.filter(key => key.endsWith('_token') || key.endsWith('_user'));
    const cloudGuard = `\n// Light edition: removed integrations and optional background features stay disabled.\nbrowser.storage.local.set(${JSON.stringify({ ...disabledCloudSettings, 'media-system-notification': '0', 'fetch-notification': '0', 'auto-download-media': '0', 'auto-download-all-domains': '0', 'mpd-to-mp4': '0', 'mux-all-audios': '0', 'stream-to-mp4': '0', 'audio-to-mp3': '0' })});\nbrowser.storage.local.remove(${JSON.stringify([...cloudTokens, 'mp3-bitrate'])});\n`;
    fs.writeFileSync(backgroundPath, background + cloudGuard, 'utf8');

    const localesDir = path.join(outDir, '_locales');
    for (const locale of fs.readdirSync(localesDir)) {
        const messagesPath = path.join(localesDir, locale, 'messages.json');
        if (!fs.existsSync(messagesPath)) continue;
        const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
        for (const key of LIGHT_SPEED_TEST_MESSAGES) delete messages[key];
        for (const key of LIGHT_DEVICE_NOTIFICATION_MESSAGES) delete messages[key];
        for (const key of LIGHT_DEAD_MESSAGES) delete messages[key];
        for (const key of Object.keys(messages)) {
            if (LIGHT_DEAD_MESSAGE_PATTERN.test(key)) delete messages[key];
            if (/gdrive|dropbox|cloudsave|settingscloud/i.test(key)) delete messages[key];
            if (/^(?:autoDownload|autoSkipDownload|autoIgnoreExcludedMedia|settingsAutoSectionTitle$)/i.test(key)) delete messages[key];
        if (/^(?:mpdToMp4|muxAllAudios)/i.test(key)) delete messages[key];
            if (/^(?:streamToMp4|manualTs)/i.test(key)) delete messages[key];
            if (/^(?:audioToMp3|mp3Bitrate|convertingToMp3)/i.test(key)) delete messages[key];
        }
        fs.writeFileSync(messagesPath, JSON.stringify(messages, null, 2) + '\n', 'utf8');
    }
}

function removeDebugSections(filePath) {
    const startMarker = 'DEBUG_ONLY_START';
    const endMarker = 'DEBUG_ONLY_END';
    let content = fs.readFileSync(filePath, 'utf8');
    let removed = 0;

    while (content.includes(startMarker)) {
        const start = content.lastIndexOf('\n', content.indexOf(startMarker)) + 1;
        const endMarkerIndex = content.indexOf(endMarker, start);
        if (endMarkerIndex === -1) {
            throw new Error(`[debug-strip] Missing ${endMarker} in ${path.relative(SRC_DIR, filePath)}`);
        }
        const endLine = content.indexOf('\n', endMarkerIndex);
        content = content.slice(0, start) + content.slice(endLine === -1 ? content.length : endLine + 1);
        removed++;
    }

    if (removed === 0) {
        throw new Error(`[debug-strip] Missing ${startMarker} in ${path.relative(SRC_DIR, filePath)}`);
    }
    fs.writeFileSync(filePath, content, 'utf8');
}

function stripDebugFeatures(outDir) {
    for (const htmlName of ['pages/popup.html', 'pages/download.html', 'pages/offscreen.html', 'pages/stream_processor.html', 'pages/audio_processor.html']) {
        const htmlPath = path.join(outDir, htmlName);
        if (!fs.existsSync(htmlPath)) continue;
        let html = fs.readFileSync(htmlPath, 'utf8');
        html = html.replace(/^[ \t]*<script\s+src=["']\.\.\/lib\/debug_logger\.js["']><\/script>\r?\n/gm, '');
        html = html.replace(/<script\s+src=["']\.\.\/lib\/debug_logger\.js["']><\/script>/g, '');
        fs.writeFileSync(htmlPath, html, 'utf8');
    }

    const popupPath = path.join(outDir, 'pages', 'popup.html');
    if (fs.existsSync(popupPath)) {
        removeDebugSections(popupPath);
    }

    removeDebugSections(path.join(outDir, 'settings', 'perawatan', 'debug.js'));
    removeDebugSections(path.join(outDir, 'settings', 'boot.js'));

    const backgroundPath = path.join(outDir, 'network_detector.js');
    if (fs.existsSync(backgroundPath)) {
        let background = fs.readFileSync(backgroundPath, 'utf8');
        background = background.replace(/importScripts\(\s*['"]lib\/debug_logger\.js['"]\s*,\s*/g, 'importScripts(');
        fs.writeFileSync(backgroundPath, background, 'utf8');
    }

    const manifestPath = path.join(outDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.background && Array.isArray(manifest.background.scripts)) {
            manifest.background.scripts = manifest.background.scripts.filter(script => script !== 'lib/debug_logger.js');
        }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n', 'utf8');
    }

    const localesDir = path.join(outDir, '_locales');
    if (fs.existsSync(localesDir)) {
        for (const locale of fs.readdirSync(localesDir)) {
            const messagesPath = path.join(localesDir, locale, 'messages.json');
            if (!fs.existsSync(messagesPath)) continue;
            const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
            for (const key of DEBUG_MESSAGE_KEYS) delete messages[key];
            fs.writeFileSync(messagesPath, JSON.stringify(messages, null, 2) + '\n', 'utf8');
        }
    }
}

function stripChromeUnsupportedMediaCache(outDir) {
    const popupPath = path.join(outDir, 'pages', 'popup.html');
    if (fs.existsSync(popupPath)) {
        const startMarker = 'FIREFOX_ONLY_MEDIA_CACHE_START';
        const endMarker = 'FIREFOX_ONLY_MEDIA_CACHE_END';
        let content = fs.readFileSync(popupPath, 'utf8');
        while (content.includes(startMarker)) {
            const start = content.lastIndexOf('\n', content.indexOf(startMarker)) + 1;
            const endMarkerIndex = content.indexOf(endMarker, start);
            if (endMarkerIndex === -1) break;
            const endLine = content.indexOf('\n', endMarkerIndex);
            content = content.slice(0, start) + content.slice(endLine === -1 ? content.length : endLine + 1);
        }
        fs.writeFileSync(popupPath, content, 'utf8');
    }

    for (const namaModul of ['state.js', 'pengaturan.js']) {
        const settingsPath = path.join(outDir, 'settings', namaModul);
        if (fs.existsSync(settingsPath)) {
            let settings = fs.readFileSync(settingsPath, 'utf8');
            settings = settings.replace(/'media-cache',\s*/g, '');
            fs.writeFileSync(settingsPath, settings, 'utf8');
        }
    }
}

function finalizeManifest(target, outDir, isDebug = false) {
    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (FIREFOX_BASED_TARGETS.has(target)) {
        manifest.permissions = (manifest.permissions || []).filter(permission => permission !== 'offscreen');
        if (manifest.background) delete manifest.background.service_worker;
        if (isDebug && FIREFOX_DEBUG_IDS[target]) {
            manifest.browser_specific_settings = manifest.browser_specific_settings || {};
            manifest.browser_specific_settings.gecko = manifest.browser_specific_settings.gecko || {};
            manifest.browser_specific_settings.gecko.id = FIREFOX_DEBUG_IDS[target];
        }
    }
    if (TARGET_AMO.has(target)) {
        if (manifest.browser_specific_settings?.gecko) {
            delete manifest.browser_specific_settings.gecko.update_url;
        }
        const parts = String(manifest.version || '').split('.');
        if (parts.length === 3) manifest.version = manifest.version + '.1';
    }
    if (LIGHT_TARGETS.has(target)) {
        manifest.permissions = (manifest.permissions || []).filter(permission => permission !== 'identity');
        delete manifest.oauth2;
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n', 'utf8');
}

function validasiBerkasTerlarang(baseTarget, outDir, targetLabel) {
    const terlarang = new Set(EXCLUDE_PER_TARGET[baseTarget] || []);
    if (terlarang.size === 0) return;
    const cekDir = (dir) => {
        for (const entri of fs.readdirSync(dir, { withFileTypes: true })) {
            const jalur = path.join(dir, entri.name);
            if (entri.isDirectory()) cekDir(jalur);
            else if (terlarang.has(entri.name)) {
                throw new Error(`[${targetLabel}] Excluded file leaked into build: ${entri.name}`);
            }
        }
    };
    cekDir(outDir);
}

function validasiLoggerDebug(berkas, outDir, isDebug, targetLabel) {
    if (!isDebug) {
        if (fs.existsSync(path.join(outDir, 'lib', 'debug_logger.js'))) {
            throw new Error(`[${targetLabel}] debug_logger.js leaked into non-debug build`);
        }
        if (berkas.popup.includes('debug_logger.js') || berkas.popup.includes('download-debug-log')) {
            throw new Error(`[${targetLabel}] Debug logger UI/script leaked into popup.html`);
        }
        if (berkas.pengaturan.includes('setupDebugLogControls') || berkas.pengaturan.includes('WMDDebugLogger')) {
            throw new Error(`[${targetLabel}] Debug logger controls leaked into settings.js`);
        }
        if (berkas.latar.includes('debug_logger.js')) {
            throw new Error(`[${targetLabel}] debug_logger.js import leaked into background files`);
        }
    } else if (!fs.existsSync(path.join(outDir, 'lib', 'debug_logger.js'))) {
        throw new Error(`[${targetLabel}] debug_logger.js is missing from debug build`);
    }
}

function validasiFungsiLatar(berkas, target) {
    if (berkas.latar.includes('createMediaFetchOptions(') && !berkas.latar.includes('function createMediaFetchOptions(')) {
        throw new Error(`[${target}] createMediaFetchOptions is used but not defined`);
    }
    if (berkas.latar.includes('restorePersistentProcessingJobs(') && !berkas.latar.includes('function restorePersistentProcessingJobs(')) {
        throw new Error(`[${target}] restorePersistentProcessingJobs is used but not defined`);
    }
}

function validasiFungsiDibusak(berkas, target) {
    const calonDibusak = [
        'getM3U8VariantsBg',
        'restoreActiveDownloadsFromSession',
        'injectNotificationScript',
        'autoUpdateHistoryLink',
        'showSimpleToast',
        'normalizeAutoDownloadDomain',
        'assembleBlobFromCache'
    ];
    for (const nama of calonDibusak) {
        const dipakai = new RegExp(`\\b${nama}\\b`).test(berkas.latar);
        const didefinisikno = berkas.latar.includes(`function ${nama}(`);
        if (dipakai && !didefinisikno) {
            throw new Error(`[${target}] ${nama} is used but not defined in Light build`);
        }
    }
}

function validasiManifes(berkas, target, targetLabel) {
    const manifes = berkas.manifes;
    if (!FIREFOX_BASED_TARGETS.has(target)) {
        if (berkas.popup.includes('id="media-cache"')) {
            throw new Error(`[${targetLabel}] Firefox-only media-cache toggle leaked into Chrome build`);
        }
    }
    if (FIREFOX_BASED_TARGETS.has(target)) {
        if (manifes.permissions?.includes('offscreen')) {
            throw new Error(`[${target}] Chrome-only "offscreen" permission leaked into manifest`);
        }
        if (manifes.background?.service_worker) {
            throw new Error(`[${target}] Chrome-only background service worker leaked into manifest`);
        }
        if (!manifes.background?.scripts?.length) {
            throw new Error(`[${target}] Missing background scripts`);
        }
    }
    if (LIGHT_TARGETS.has(target) && !manifes.name.startsWith('Website Media Downloader Light')) {
        throw new Error(`[${target}] Light manifest override was not applied`);
    }
    if (CHROME_LIGHT_TARGETS.has(target)) {
        if (manifes.developer || manifes.browser_specific_settings) {
            throw new Error(`[${target}] Firefox-only manifest keys leaked into Chrome build`);
        }
        if (manifes.background?.scripts || !manifes.background?.service_worker) {
            throw new Error(`[${target}] Chrome MV3 build must use a background service worker`);
        }
        for (const permission of ['webRequestBlocking', 'webRequestFilterResponse']) {
            if (manifes.permissions?.includes(permission)) {
                throw new Error(`[${target}] Firefox-only permission leaked into Chrome build: ${permission}`);
            }
        }
    }
    if (target === 'firefox-light' || target === 'firefox-light-amo') {
        const standardId = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'manifest.json'), 'utf8')).browser_specific_settings?.gecko?.id;
        const lightId = manifes.browser_specific_settings?.gecko?.id;
        if (!lightId || lightId === standardId) {
            throw new Error(`[${target}] A dedicated Firefox extension ID is required`);
        }
    }
}

function validasiRingan(berkas, outDir, target) {
    const popup = berkas.popup;
    const pengaturan = berkas.pengaturan;
    const unduhan = wocoGabunganUnduhan(outDir);
    const konverter = wocoGabunganKonverter(outDir);
    const sumberRingan = [konverter, berkas.latar, unduhan, pengaturan].join('\n');
    for (const notificationSetting of ['media-notification']) {
        if (!popup.includes(`id="${notificationSetting}"`)) {
            throw new Error(`[${target}] Notification setting is missing from Light build: ${notificationSetting}`);
        }
    }
    for (const removedNotificationSetting of ['media-system-notification', 'fetch-notification']) {
        if (popup.includes(`id="${removedNotificationSetting}"`)) {
            throw new Error(`[${target}] Removed device notification setting leaked into Light build: ${removedNotificationSetting}`);
        }
    }
    if (/async function showMediaNotification\([^)]*\)\s*{\s*return;\s*}/.test(berkas.latar)) {
        throw new Error(`[${target}] In-page media notifications were disabled in Light build`);
    }
    if (!unduhan.includes('const activeJobs = new Map();')) {
        throw new Error(`[${target}] Download manager state was removed from Light build`);
    }
    if (popup.includes('start-speed-test') || pengaturan.includes('setupSpeedTest') || pengaturan.includes('speed.cloudflare.com')) {
        throw new Error(`[${target}] Speed Test code leaked into build`);
    }
    if (popup.includes('cloud-save-location') || popup.includes('gdrive-login-btn') || popup.includes('dropbox-login-btn')) {
        throw new Error(`[${target}] Cloud settings UI leaked into build`);
    }
    if (berkas.manifes.permissions?.includes('identity') || berkas.manifes.oauth2) {
        throw new Error(`[${target}] Cloud authentication capability leaked into manifest`);
    }
    if (/googleapis\.com|dropboxapi\.com|launchWebAuthFlow/.test(sumberRingan)) {
        throw new Error(`[${target}] Disabled cloud integration code leaked into Light build`);
    }
    if (/libraries\/mux\.js|mp4_duration\.js/.test(sumberRingan)) {
        throw new Error(`[${target}] Disabled stream conversion references leaked into Light build`);
    }
    if (popup.includes('audio-to-mp3') || popup.includes('mp3-bitrate')) {
        throw new Error(`[${target}] MP3 conversion settings UI leaked into build`);
    }
    const konverterPakaiMediabunny = konverter.includes('Mediabunny');
    const adaMediabunny = fs.existsSync(path.join(outDir, 'libraries', 'mediabunny.min.js'));
    if (konverterPakaiMediabunny && !adaMediabunny) {
        throw new Error(`[${target}] Mediabunny library is missing from Light build`);
    }
    if (!konverterPakaiMediabunny && adaMediabunny) {
        throw new Error(`[${target}] Unused Mediabunny library leaked into Light build`);
    }
    if (konverter.includes('updateProgressStatus(') && !konverter.includes('function updateProgressStatus(')) {
        throw new Error(`[${target}] updateProgressStatus is used but not defined in Light build`);
    }
    const kebocoranLibav = [];
    const auditLibAv = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) auditLibAv(entryPath);
            else if (/\.(?:js|html|json|md)$/i.test(entry.name) && /libav/i.test(fs.readFileSync(entryPath, 'utf8'))) {
                kebocoranLibav.push(path.relative(outDir, entryPath));
            }
        }
    };
    auditLibAv(outDir);
    if (kebocoranLibav.length) throw new Error(`[${target}] LibAV references leaked into: ${kebocoranLibav.join(', ')}`);
    for (const locale of fs.readdirSync(path.join(outDir, '_locales'))) {
        const messagesPath = path.join(outDir, '_locales', locale, 'messages.json');
        if (!fs.existsSync(messagesPath)) continue;
        const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
        for (const notificationMessage of ['mediaNotificationTitle', 'mediaNotificationDownloadAction']) {
            if (!Object.hasOwn(messages, notificationMessage)) {
                throw new Error(`[${target}] Notification translation is missing from locale ${locale}: ${notificationMessage}`);
            }
        }
        if (LIGHT_SPEED_TEST_MESSAGES.some(key => Object.hasOwn(messages, key))) {
            throw new Error(`[${target}] Speed Test translations leaked into locale: ${locale}`);
        }
        const deadMessages = Object.keys(messages).filter(key =>
            LIGHT_DEAD_MESSAGES.includes(key) || LIGHT_DEAD_MESSAGE_PATTERN.test(key)
        );
        if (deadMessages.length) {
            throw new Error(`[${target}] Removed feature translations leaked into locale ${locale}: ${deadMessages.join(', ')}`);
        }
    }
}

function validateTarget(baseTarget, outDir, isDebug = false) {
    const targetLabel = isDebug ? `${baseTarget}-debug` : baseTarget;
    const target = baseTarget;
    const berkas = {
        manifes: JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')),
        popup: fs.readFileSync(path.join(outDir, 'pages', 'popup.html'), 'utf8'),
        latar: wocoGabunganLatar(outDir),
        pengaturan: wocoGabunganPengaturan(outDir),
    };
    validasiBerkasTerlarang(baseTarget, outDir, targetLabel);
    validasiLoggerDebug(berkas, outDir, isDebug, targetLabel);
    validasiFungsiLatar(berkas, target);
    validasiManifes(berkas, target, targetLabel);
    if (LIGHT_TARGETS.has(target)) validasiFungsiDibusak(berkas, target);
    if (LIGHT_TARGETS.has(target)) validasiRingan(berkas, outDir, target);
}

function buildTarget(target) {
    const isDebug = target.endsWith('-debug');
    const baseTarget = isDebug ? target.slice(0, -6) : target;
    const outDir = path.join(BUILD_DIR, target);
    cleanDir(outDir);
    fs.mkdirSync(outDir, { recursive: true });

    const targetExcludes = new Set(EXCLUDE_PER_TARGET[baseTarget] || []);
    if (!isDebug) {
        targetExcludes.add('debug_logger.js');
    }
    for (const entry of fs.readdirSync(SRC_DIR)) {
        if (EXCLUDE_FROM_BUILD.has(entry) || targetExcludes.has(entry)) continue;
        copyRecursive(path.join(SRC_DIR, entry), path.join(outDir, entry), new Set([...targetExcludes, ...EXCLUDE_FROM_BUILD]));
    }

    applyOverrides(baseTarget, outDir, targetExcludes);
    if (!FIREFOX_BASED_TARGETS.has(baseTarget)) stripChromeUnsupportedMediaCache(outDir);
    if (!isDebug) stripDebugFeatures(outDir);
    if (LIGHT_TARGETS.has(baseTarget)) stripLightFeatures(outDir);
    finalizeManifest(baseTarget, outDir, isDebug);
    validateTarget(baseTarget, outDir, isDebug);

    const overrideCount = countOverrideFiles(baseTarget);
    console.log(`[OK] ${target} build -> build/${target}/  (${overrideCount} override${overrideCount !== 1 ? 's' : ''} applied)`);
}

const args = process.argv.slice(2);
const command = (args[0] || 'all').toLowerCase();

if ([...BASE_TARGETS, ...DEBUG_TARGETS].includes(command)) {
    buildTarget(command);
} else if (command === 'light') {
    for (const target of LIGHT_TARGETS) buildTarget(target);
} else if (command === 'debug') {
    for (const target of DEBUG_TARGETS) buildTarget(target);
} else if (command === 'all') {
    for (const target of BASE_TARGETS) buildTarget(target);
    for (const target of DEBUG_TARGETS) buildTarget(target);
} else if (command === 'clean') {
    cleanDir(BUILD_DIR);
    console.log('[OK] build/ cleaned');
} else {
    console.error(`[ERROR] Unknown command: ${command}`);
    console.error('Usage: node src/build.js [chrome|chrome-yt|firefox|firefox-amo|chrome-light|chrome-yt-light|firefox-light|firefox-light-amo|<target>-debug|light|debug|all|clean]');
    process.exit(1);
}
