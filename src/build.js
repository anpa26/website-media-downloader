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

const EXCLUDE_PER_TARGET = {
    chrome: new Set(['yt_core.js', 'wymd.js', ...MEDIABUNNY_FILES]),
    'chrome-yt': new Set(MEDIABUNNY_FILES),
    firefox: new Set([...FIREFOX_EXCLUDES, ...MEDIABUNNY_FILES]),
    'chrome-light': new Set(['yt_core.js', 'wymd.js', 'download_recovery.js', 'audio_processor.html', 'libav.js', ...LIGHT_MP3_FILES, ...LIGHT_STREAM_CONVERSION_FILES]),
    'chrome-yt-light': new Set(['download_recovery.js', 'audio_processor.html', 'libav.js', ...LIGHT_MP3_FILES, ...LIGHT_STREAM_CONVERSION_FILES]),
    'firefox-light': new Set([...FIREFOX_EXCLUDES, 'libav.js', ...LIGHT_MP3_FILES, ...LIGHT_STREAM_CONVERSION_FILES])
};

const FORBIDDEN_PER_TARGET = {
    firefox: [...FIREFOX_EXCLUDES],
    'firefox-light': [...FIREFOX_EXCLUDES]
};

const FIREFOX_BASED_TARGETS = new Set(['firefox', 'firefox-light']);
const CHROME_LIGHT_TARGETS = new Set(['chrome-light', 'chrome-yt-light']);
const LIGHT_TARGETS = new Set(['chrome-light', 'chrome-yt-light', 'firefox-light']);
const BASE_TARGETS = ['chrome', 'chrome-yt', 'firefox', 'chrome-light', 'chrome-yt-light', 'firefox-light'];
const DEBUG_TARGETS = BASE_TARGETS.map(target => `${target}-debug`);
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
    'firefox-light': ['light', 'firefox-light']
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
function applyOverrides(target, outDir) {
    const overrideTargets = OVERRIDE_CHAIN_PER_TARGET[target] || [target];
    for (const overrideTarget of overrideTargets) {
        const overrideDir = path.join(OVERRIDES_DIR, overrideTarget);
        if (fs.existsSync(overrideDir)) applyOverridesRecursive(overrideDir, outDir);
    }
}

function applyOverridesRecursive(overrideDir, outDir) {
    for (const entry of fs.readdirSync(overrideDir)) {
        const overridePath = path.join(overrideDir, entry);
        const destPath = path.join(outDir, entry);
        const stat = fs.statSync(overridePath);

        if (stat.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            applyOverridesRecursive(overridePath, destPath);
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

function stripLibAvCode(outDir) {
    const muxReplacement = fs.readFileSync(path.join(SRC_DIR, 'light_mediabunny_mux.js'), 'utf8');
    const subtitleReplacement = fs.readFileSync(path.join(SRC_DIR, 'light_mediabunny_subtitles.js'), 'utf8');
    const converterPath = path.join(outDir, 'offlineStreamConvert.js');
    let converter = fs.readFileSync(converterPath, 'utf8');
    const muxResult = replaceNamedFunction(converter, 'downloadAndMuxYoutube', muxReplacement);
    converter = muxResult.source;

    const subtitleResult = replaceNamedFunction(
        converter,
        'embedSubtitlesWithLibAV',
        subtitleReplacement
    );
    converter = subtitleResult.source;

    fs.copyFileSync(
        path.join(SRC_DIR, 'light_mediabunny_worker.js'),
        path.join(outDir, 'light_mediabunny_worker.js')
    );

    const mpdFlag = 'if (mpdToMp4Enabled) {';
    const mpdStart = converter.lastIndexOf(mpdFlag);
    if (mpdStart !== -1) {
        const openBrace = converter.indexOf('{', mpdStart);
        const end = findMatchingBrace(converter, openBrace);
        converter = converter.slice(0, mpdStart) + 'if (false) {}' + converter.slice(end + 1);
    }

    fs.writeFileSync(converterPath, converter, 'utf8');

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

    for (const htmlName of ['popup.html', 'audio_processor.html', 'offscreen.html', 'stream_processor.html']) {
        const htmlPath = path.join(outDir, htmlName);
        if (!fs.existsSync(htmlPath)) continue;
        let html = fs.readFileSync(htmlPath, 'utf8');
        if (!html.includes('offlineStreamConvert.js')) continue;
        html = html.replace(
            /(<script\s+src=["']offlineStreamConvert\.js["']><\/script>)/,
            '<script src="libraries/mediabunny.min.js"></script>\n$1'
        );
        fs.writeFileSync(htmlPath, html, 'utf8');
    }
}

function stripMp3Conversion(outDir) {
    const converterPath = path.join(outDir, 'offlineStreamConvert.js');
    let converter = fs.readFileSync(converterPath, 'utf8');
    converter = replaceNamedFunction(
        converter,
        'convertM4aToMp3Direct',
        `async function convertM4aToMp3Direct(blob, filename) {\n    return { blob, filename: filename.replace(/\\.mp3$/i, '.m4a') };\n}`
    ).source;
    converter = replaceNamedFunction(
        converter,
        'convertAudioToMp3IfEnabled',
        `async function convertAudioToMp3IfEnabled(blob, filename) {\n    return { blob, filename: filename.replace(/\\.mp3$/i, '.wav') };\n}`
    ).source;
    fs.writeFileSync(converterPath, converter, 'utf8');
}

function stripDisabledIntegrations(outDir) {
    const unavailable = `throw new Error('This integration is not available in the Light edition.');`;
    const cloudStubs = [
        'startDropboxStreamUpload', 'appendDropboxStream', 'finishDropboxStream',
        'startGDriveStreamUpload', 'uploadStreamChunk', 'reauthDropbox', 'reauthGDrive',
        'uploadToDropbox', 'uploadToGDrive', 'uploadChunks'
    ].map(name => `async function ${name}() { ${unavailable} }`).join('\n');
    const backgroundCloudStubs = [
        'startDropboxStreamUpload', 'appendDropboxStream', 'finishDropboxStream',
        'startGDriveStreamUpload', 'uploadStreamChunk', 'reauthDropbox', 'reauthGDrive',
        'uploadToGDrive', 'uploadChunks'
    ].map(name => `async function ${name}() { ${unavailable} }`).join('\n');

    const converterPath = path.join(outDir, 'offlineStreamConvert.js');
    replaceSection(converterPath, 'class CloudUploadController', 'function getExtFromMime', cloudStubs);
    replaceSection(
        converterPath,
        '    let transmuxer = null;',
        '    let nextUploadIndex = 0;',
        '    let transmuxer = null;\n    const transmuxedOutputQueue = [];'
    );
    stripDisabledFunctionBodies(converterPath, {
        transmuxToMp4: unavailable
    });
    let converter = fs.readFileSync(converterPath, 'utf8');
    converter = converter.replace("const ensureMuxJsLoaded = () => ensureOptionalLibraryLoaded('libraries/mux.js', 'muxjs');\n", '');
    converter = replaceNamedFunction(converter, 'updateProgressStatus', '').source;
    fs.writeFileSync(converterPath, converter, 'utf8');

    const backgroundPath = path.join(outDir, 'network_detector.js');
    replaceSection(
        backgroundPath,
        'function uploadToDropbox',
        'async function assembleBlobFromCache',
        `async function uploadToDropbox() { ${unavailable} }\nasync function uploadFromCacheToDropbox() { ${unavailable} }\nasync function uploadFromCacheToGDrive() { ${unavailable} }`
    );
    replaceSection(backgroundPath, 'class CloudUploadController', 'async function handleFetchDownload', backgroundCloudStubs);
    stripDisabledFunctionBodies(backgroundPath, {
        maybeAutoDownloadMedia: 'return false;',
        scheduleExistingMediaAutoDownload: 'return;'
    });

    replaceSection(path.join(outDir, 'download.js'), 'class CloudUploadController', 'const activeJobs', cloudStubs);
    replaceSection(
        path.join(outDir, 'settings.js'),
        "    const gdriveBtn = document.getElementById('gdrive-login-btn');\n    const gdriveText = document.getElementById('gdrive-login-text');",
        "    const layoutResult = await browser.storage.local.get('settings-layout');",
        ''
    );

    const removeIfPresent = (filePath, functionNames) => {
        let source = fs.readFileSync(filePath, 'utf8');
        for (const functionName of functionNames) {
            const occurrences = source.match(new RegExp(`\\b${functionName}\\b`, 'g'))?.length || 0;
            if (occurrences !== 1) continue;
            source = replaceNamedFunction(source, functionName, '').source;
        }
        fs.writeFileSync(filePath, source, 'utf8');
    };
    removeIfPresent(backgroundPath, [
        'getM3U8VariantsBg',
        'restoreActiveDownloadsFromSession',
        'injectNotificationScript',
        'autoUpdateHistoryLink',
        'showSimpleToast',
        'normalizeAutoDownloadDomain',
        'assembleBlobFromCache'
    ]);
}

function stripLightFeatures(outDir) {
    const popupPath = path.join(outDir, 'popup.html');
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
    removeMarkedSections(path.join(outDir, 'settings.js'), 'SPEED_TEST');
    stripLibAvCode(outDir);
    stripMp3Conversion(outDir);
    stripDisabledIntegrations(outDir);

    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const workerResources = ['light_mediabunny_worker.js', 'libraries/mediabunny.min.js'];
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
    for (const htmlName of ['popup.html', 'download.html', 'offscreen.html', 'stream_processor.html', 'audio_processor.html']) {
        const htmlPath = path.join(outDir, htmlName);
        if (!fs.existsSync(htmlPath)) continue;
        let html = fs.readFileSync(htmlPath, 'utf8');
        html = html.replace(/^[ \t]*<script\s+src=["']debug_logger\.js["']><\/script>\r?\n/gm, '');
        html = html.replace(/<script\s+src=["']debug_logger\.js["']><\/script>/g, '');
        fs.writeFileSync(htmlPath, html, 'utf8');
    }

    const popupPath = path.join(outDir, 'popup.html');
    if (fs.existsSync(popupPath)) {
        removeDebugSections(popupPath);
    }

    const settingsPath = path.join(outDir, 'settings.js');
    if (fs.existsSync(settingsPath)) {
        removeDebugSections(settingsPath);
    }

    const backgroundPath = path.join(outDir, 'network_detector.js');
    if (fs.existsSync(backgroundPath)) {
        let background = fs.readFileSync(backgroundPath, 'utf8');
        background = background.replace(/importScripts\(\s*['"]debug_logger\.js['"]\s*,\s*/g, 'importScripts(');
        fs.writeFileSync(backgroundPath, background, 'utf8');
    }

    const manifestPath = path.join(outDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.background && Array.isArray(manifest.background.scripts)) {
            manifest.background.scripts = manifest.background.scripts.filter(script => script !== 'debug_logger.js');
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
    const popupPath = path.join(outDir, 'popup.html');
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

    const settingsPath = path.join(outDir, 'settings.js');
    if (fs.existsSync(settingsPath)) {
        let settings = fs.readFileSync(settingsPath, 'utf8');
        settings = settings.replace(/'media-cache',\s*/g, '');
        fs.writeFileSync(settingsPath, settings, 'utf8');
    }
}

function finalizeManifest(target, outDir) {
    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (FIREFOX_BASED_TARGETS.has(target)) {
        manifest.permissions = (manifest.permissions || []).filter(permission => permission !== 'offscreen');
        if (manifest.background) delete manifest.background.service_worker;
    }
    if (LIGHT_TARGETS.has(target)) {
        manifest.permissions = (manifest.permissions || []).filter(permission => permission !== 'identity');
        delete manifest.oauth2;
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n', 'utf8');
}

function validateTarget(baseTarget, outDir, isDebug = false) {
    const targetLabel = isDebug ? `${baseTarget}-debug` : baseTarget;
    for (const relativePath of FORBIDDEN_PER_TARGET[baseTarget] || []) {
        if (fs.existsSync(path.join(outDir, relativePath))) {
            throw new Error(`[${targetLabel}] Browser-specific file leaked into build: ${relativePath}`);
        }
    }

    if (!isDebug) {
        if (fs.existsSync(path.join(outDir, 'debug_logger.js'))) {
            throw new Error(`[${targetLabel}] debug_logger.js leaked into non-debug build`);
        }
        const popupHtml = fs.readFileSync(path.join(outDir, 'popup.html'), 'utf8');
        const settingsJs = fs.readFileSync(path.join(outDir, 'settings.js'), 'utf8');
        const bgJs = fs.readFileSync(path.join(outDir, 'network_detector.js'), 'utf8');
        if (popupHtml.includes('debug_logger.js') || popupHtml.includes('download-debug-log')) {
            throw new Error(`[${targetLabel}] Debug logger UI/script leaked into popup.html`);
        }
        if (settingsJs.includes('setupDebugLogControls') || settingsJs.includes('WMDDebugLogger')) {
            throw new Error(`[${targetLabel}] Debug logger controls leaked into settings.js`);
        }
        if (bgJs.includes('debug_logger.js')) {
            throw new Error(`[${targetLabel}] debug_logger.js import leaked into network_detector.js`);
        }
    } else {
        if (!fs.existsSync(path.join(outDir, 'debug_logger.js'))) {
            throw new Error(`[${targetLabel}] debug_logger.js is missing from debug build`);
        }
    }

    const target = baseTarget;

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    const background = fs.readFileSync(path.join(outDir, 'network_detector.js'), 'utf8');
    if (background.includes('createMediaFetchOptions(') && !background.includes('function createMediaFetchOptions(')) {
        throw new Error(`[${target}] createMediaFetchOptions is used but not defined`);
    }
    if (!FIREFOX_BASED_TARGETS.has(target)) {
        const popupHtml = fs.readFileSync(path.join(outDir, 'popup.html'), 'utf8');
        if (popupHtml.includes('id="media-cache"')) {
            throw new Error(`[${targetLabel}] Firefox-only media-cache toggle leaked into Chrome build`);
        }
    }
    if (FIREFOX_BASED_TARGETS.has(target)) {
        if (manifest.permissions?.includes('offscreen')) {
            throw new Error(`[${target}] Chrome-only "offscreen" permission leaked into manifest`);
        }
        if (manifest.background?.service_worker) {
            throw new Error(`[${target}] Chrome-only background service worker leaked into manifest`);
        }
        if (!manifest.background?.scripts?.length) {
            throw new Error(`[${target}] Missing background scripts`);
        }
    }

    if (LIGHT_TARGETS.has(target) && !manifest.name.startsWith('Website Media Downloader Light')) {
        throw new Error(`[${target}] Light manifest override was not applied`);
    }
    if (CHROME_LIGHT_TARGETS.has(target)) {
        if (manifest.developer || manifest.browser_specific_settings) {
            throw new Error(`[${target}] Firefox-only manifest keys leaked into Chrome build`);
        }
        if (manifest.background?.scripts || !manifest.background?.service_worker) {
            throw new Error(`[${target}] Chrome MV3 build must use a background service worker`);
        }
        for (const permission of ['webRequestBlocking', 'webRequestFilterResponse']) {
            if (manifest.permissions?.includes(permission)) {
                throw new Error(`[${target}] Firefox-only permission leaked into Chrome build: ${permission}`);
            }
        }
    }
    if (target === 'firefox-light') {
        const standardId = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'manifest.json'), 'utf8')).browser_specific_settings?.gecko?.id;
        const lightId = manifest.browser_specific_settings?.gecko?.id;
        if (!lightId || lightId === standardId) {
            throw new Error('[firefox-light] A dedicated Firefox extension ID is required');
        }
    }
    if (LIGHT_TARGETS.has(target)) {
        const popup = fs.readFileSync(path.join(outDir, 'popup.html'), 'utf8');
        const settings = fs.readFileSync(path.join(outDir, 'settings.js'), 'utf8');
        const download = fs.readFileSync(path.join(outDir, 'download.js'), 'utf8');
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
        if (/async function showMediaNotification\([^)]*\)\s*{\s*return;\s*}/.test(background)) {
            throw new Error(`[${target}] In-page media notifications were disabled in Light build`);
        }
        if (!download.includes('const activeJobs = new Map();')) {
            throw new Error(`[${target}] Download manager state was removed from Light build`);
        }
        if (popup.includes('start-speed-test') || settings.includes('setupSpeedTest') || settings.includes('speed.cloudflare.com')) {
            throw new Error(`[${target}] Speed Test code leaked into build`);
        }
        if (popup.includes('cloud-save-location') || popup.includes('gdrive-login-btn') || popup.includes('dropbox-login-btn')) {
            throw new Error(`[${target}] Cloud settings UI leaked into build`);
        }
        if (manifest.permissions?.includes('identity') || manifest.oauth2) {
            throw new Error(`[${target}] Cloud authentication capability leaked into manifest`);
        }
        if (fs.existsSync(path.join(outDir, 'libraries', 'libav.js'))) {
            throw new Error(`[${target}] LibAV library leaked into Light build`);
        }
        for (const removedMp3File of LIGHT_MP3_FILES) {
            const removedPath = removedMp3File === 'mp3_worker.js'
                ? path.join(outDir, removedMp3File)
                : path.join(outDir, 'libraries', removedMp3File);
            if (fs.existsSync(removedPath)) throw new Error(`[${target}] Removed MP3 encoder leaked into Light build: ${removedMp3File}`);
        }
        for (const removedStreamFile of LIGHT_STREAM_CONVERSION_FILES) {
            const removedPath = removedStreamFile.endsWith('.js') && removedStreamFile !== 'mp4_duration.js'
                ? path.join(outDir, 'libraries', removedStreamFile)
                : path.join(outDir, removedStreamFile);
            if (fs.existsSync(removedPath)) {
                throw new Error(`[${target}] Disabled stream converter leaked into Light build: ${removedStreamFile}`);
            }
        }
        const lightSourceFiles = ['offlineStreamConvert.js', 'network_detector.js', 'download.js', 'settings.js']
            .filter(file => fs.existsSync(path.join(outDir, file)))
            .map(file => fs.readFileSync(path.join(outDir, file), 'utf8'))
            .join('\n');
        if (/googleapis\.com|dropboxapi\.com|launchWebAuthFlow/.test(lightSourceFiles)) {
            throw new Error(`[${target}] Disabled cloud integration code leaked into Light build`);
        }
        if (/libraries\/mux\.js|mp4_duration\.js/.test(lightSourceFiles)) {
            throw new Error(`[${target}] Disabled stream conversion references leaked into Light build`);
        }
        if (CHROME_LIGHT_TARGETS.has(target)) {
            for (const firefoxFallbackFile of ['download_recovery.js', 'audio_processor.html']) {
                if (fs.existsSync(path.join(outDir, firefoxFallbackFile))) {
                    throw new Error(`[${target}] Firefox fallback leaked into Chrome Light build: ${firefoxFallbackFile}`);
                }
            }
        }
        if (popup.includes('audio-to-mp3') || popup.includes('mp3-bitrate')) {
            throw new Error(`[${target}] MP3 conversion settings UI leaked into build`);
        }
        const converterUsesMediabunny = fs.readFileSync(path.join(outDir, 'offlineStreamConvert.js'), 'utf8').includes('Mediabunny');
        const hasMediabunny = fs.existsSync(path.join(outDir, 'libraries', 'mediabunny.min.js'));
        if (converterUsesMediabunny && !hasMediabunny) {
            throw new Error(`[${target}] Mediabunny library is missing from Light build`);
        }
        if (!converterUsesMediabunny && hasMediabunny) {
            throw new Error(`[${target}] Unused Mediabunny library leaked into Light build`);
        }
        const libavLeaks = [];
        const auditLibAv = dir => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const entryPath = path.join(dir, entry.name);
                if (entry.isDirectory()) auditLibAv(entryPath);
                else if (/\.(?:js|html|json|md)$/i.test(entry.name) && /libav/i.test(fs.readFileSync(entryPath, 'utf8'))) {
                    libavLeaks.push(path.relative(outDir, entryPath));
                }
            }
        };
        auditLibAv(outDir);
        if (libavLeaks.length) throw new Error(`[${target}] LibAV references leaked into: ${libavLeaks.join(', ')}`);
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
        copyRecursive(path.join(SRC_DIR, entry), path.join(outDir, entry), targetExcludes);
    }

    applyOverrides(baseTarget, outDir);
    if (!FIREFOX_BASED_TARGETS.has(baseTarget)) stripChromeUnsupportedMediaCache(outDir);
    if (!isDebug) stripDebugFeatures(outDir);
    if (LIGHT_TARGETS.has(baseTarget)) stripLightFeatures(outDir);
    finalizeManifest(baseTarget, outDir);
    validateTarget(baseTarget, outDir, isDebug);

    const overrideCount = countOverrideFiles(baseTarget);
    console.log(`[OK] ${target} build -> build/${target}/  (${overrideCount} override${overrideCount !== 1 ? 's' : ''} applied)`);
}

const args = process.argv.slice(2);
const command = (args[0] || 'all').toLowerCase();

switch (command) {
    case 'chrome':
    case 'chrome-yt':
    case 'firefox':
    case 'chrome-light':
    case 'chrome-yt-light':
    case 'firefox-light':
    case 'chrome-debug':
    case 'chrome-yt-debug':
    case 'firefox-debug':
    case 'chrome-light-debug':
    case 'chrome-yt-light-debug':
    case 'firefox-light-debug':
        buildTarget(command);
        break;
    case 'light':
        for (const target of LIGHT_TARGETS) buildTarget(target);
        break;
    case 'debug':
        for (const target of DEBUG_TARGETS) buildTarget(target);
        break;
    case 'all':
        for (const target of BASE_TARGETS) buildTarget(target);
        for (const target of DEBUG_TARGETS) buildTarget(target);
        break;
    case 'clean':
        cleanDir(BUILD_DIR);
        console.log('[OK] build/ cleaned');
        break;
    default:
        console.error(`[ERROR] Unknown command: ${command}`);
        console.error('Usage: node src/build.js [chrome|chrome-yt|firefox|chrome-light|chrome-yt-light|firefox-light|<target>-debug|light|debug|all|clean]');
        process.exit(1);
}
