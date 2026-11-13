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



const CACHE_DB_NAME = 'MediaCacheDB';
const CACHE_STORE_NAMES = ['network-cache', 'download-chunks'];
const SETTINGS_EXPORT_FORMAT = 'website-media-downloader-settings';
const SETTINGS_EXPORT_VERSION = 1;
const SETTINGS_KEYS = [
    'auto-download-media', 'auto-download-quality', 'auto-download-all-domains', 'auto-download-domains', 'auto-skip-download-names', 'auto-skip-download-names-only', 'auto-skip-download-domains', 'auto-ignore-excluded-media', 'auto-download-video', 'auto-download-stream',
    'manual-scan', 'manual-scan-keep-tabs', 'remove-on-tab-close', 'document-scan', 'document-scan-mode', 'url-detection', 'mime-detection', 'detect-download-links', 'hide-segments', 'hide-page-components', 'disable-deduplication', 'optimize-low-end', 'limit-media-list', 'limit-media-list-custom', 'min-file-size', 'min-file-size-custom',
    'only-video', 'only-audio', 'only-stream', 'only-image', 'image-min-side', 'image-min-side-custom', 'image-min-file-size', 'image-min-file-size-custom', 'hide-image-without-size', 'only-subtitle', 'only-file', 'ignore-disabled-types',
    'media-notification', 'audio-process-notification', 'media-system-notification', 'stack-notifications', 'download-method', 'fetch-notification', 'speed-boost', 'speed-boost-resume', 'connections', 'stream-download',
    'stream-quality', 'subtitle-conversion', 'mpd-fix', 'background-download', 'audio-to-mp3', 'mp3-bitrate', 'open-preference', 'mux-all-audios', 'gabung-stream', 'mpd-to-mp4',
    'embed-subtitles-mkv', 'embed-subtitles-container', 'embed-subtitles-nonyt', 'block-incoming-popups', 'redirect-guard-clicks', 'redirect-guard-hide-content',
    'ignore-excluded-media', 'skip-detection-names', 'skip-detection-names-only', 'skip-detection-domains', 'filename-template', 'disable-rename-dialog', 'history-page', 'settings-layout', 'top-header-design', 'bottom-bar-design', 'theme-mode', 'theme-color', 'group-by-type', 'group-download-progress', 'save-to-gdrive', 'gdrive-stream', 'media-sort-order',
    'save-to-dropbox', 'dropbox-stream', 'auto-check-update', 'badge-counter', 'ui-scale', 'ui-scale-custom'
];

let settingsPageInitPromise = null;

let pendingChanges = {};
let isInitializing = false;
