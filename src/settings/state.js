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
    'auto-download-media', 'auto-download-quality', 'auto-download-youtube-mode', 'auto-download-all-domains', 'auto-download-domains', 'auto-skip-download-names', 'auto-skip-download-names-only', 'auto-skip-download-domains', 'auto-ignore-excluded-media', 'auto-download-video', 'auto-download-stream',
    'manual-scan', 'manual-scan-keep-tabs', 'remove-on-tab-close', 'document-scan', 'document-scan-mode', 'url-detection', 'youtube-detection', 'mime-detection', 'detect-download-links', 'hide-segments', 'hide-page-components', 'disable-deduplication', 'optimize-low-end', 'limit-media-list', 'limit-media-list-custom', 'min-file-size', 'min-file-size-custom',
    'only-video', 'only-audio', 'only-stream', 'only-image', 'image-min-side', 'image-min-side-custom', 'image-min-file-size', 'image-min-file-size-custom', 'hide-image-without-size', 'only-subtitle', 'only-file', 'ignore-disabled-types',
    'media-notification', 'audio-process-notification', 'media-system-notification', 'stack-notifications', 'download-method', 'fetch-notification', 'skip-http-errors', 'media-cache', 'speed-boost', 'speed-boost-resume', 'connections', 'stream-download',
    'stream-quality', 'subtitle-conversion', 'mpd-fix', 'background-download', 'audio-to-mp3', 'mp3-bitrate', 'open-preference', 'mux-all-audios', 'gabung-stream', 'mpd-to-mp4',
    'embed-subtitles-mkv', 'embed-subtitles-container', 'embed-subtitles-nonyt', 'block-incoming-popups', 'redirect-guard-clicks', 'redirect-guard-hide-content',
    'ignore-excluded-media', 'skip-detection-names', 'skip-detection-names-only', 'skip-detection-domains', 'filename-template', 'disable-rename-dialog', 'history-page', 'settings-layout', 'top-header-design', 'bottom-bar-design', 'theme-mode', 'theme-color', 'group-by-type', 'group-download-progress', 'save-to-gdrive', 'gdrive-stream', 'media-sort-order',
    'save-to-dropbox', 'dropbox-stream', 'auto-check-update', 'badge-counter', 'ui-scale', 'ui-scale-custom'
];

const DAFTAR_BAWAAN_AKTIF = [
    'auto-download-video', 'auto-download-stream', 'auto-ignore-excluded-media',
    'ignore-excluded-media',
    'document-scan', 'url-detection', 'youtube-detection', 'mime-detection', 'hide-page-components', 'hide-segments',
    'media-notification', 'audio-process-notification', 'media-system-notification', 'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle',
    'background-download', 'only-file', 'gabung-stream', 'auto-check-update', 'badge-counter',
    'detect-download-links', 'disable-deduplication', 'fetch-notification', 'group-by-type', 'group-download-progress'
];
const DAFTAR_BAWAAN_MATI = [
    'auto-download-media', 'auto-download-all-domains', 'manual-scan', 'manual-scan-keep-tabs', 'remove-on-tab-close', 'ignore-disabled-types', 'hide-image-without-size', 'history-page', 'save-to-gdrive', 'gdrive-stream', 'save-to-dropbox', 'dropbox-stream', 'stack-notifications', 'mux-all-audios', 'embed-subtitles-mkv', 'embed-subtitles-nonyt', 'mpd-to-mp4', 'block-incoming-popups', 'redirect-guard-hide-content', 'audio-to-mp3'
];
const NILAI_BAWAAN_LAIN = {
    'speed-boost': '0', 'speed-boost-resume': '0', 'disable-rename-dialog': '0',
    'connections': '4', 'mp3-bitrate': '320', 'auto-download-quality': 'highest',
    'auto-download-youtube-mode': 'video', 'theme-mode': 'auto', 'document-scan-mode': 'light',
    'image-min-side': '0', 'image-min-side-custom': '512',
    'image-min-file-size': '0', 'image-min-file-size-custom': '0'
};
const NILAI_BAWAAN_PILIHAN = {
    'limit-media-list': 'custom', 'document-scan-mode': 'light', 'settings-layout': 'tabs-icons',
    'top-header-design': 'v1', 'bottom-bar-design': 'v3', 'theme-mode': 'auto',
    'open-preference': 'popup', 'download-method': 'fetch', 'stream-quality': 'highest',
    'subtitle-conversion': 'none', 'embed-subtitles-container': 'mp4',
    'redirect-guard-clicks': '2', 'connections': '4', 'media-sort-order': 'newest',
    'mp3-bitrate': '320', 'min-file-size': '0', 'image-min-side': '0',
    'ui-scale': '85%', 'stream-download': 'offline'
};

function itungNilaiBawaanSetelan(kunci) {
    if (DAFTAR_BAWAAN_AKTIF.includes(kunci)) return '1';
    if (DAFTAR_BAWAAN_MATI.includes(kunci)) return '0';
    if (NILAI_BAWAAN_LAIN[kunci] !== undefined) return NILAI_BAWAAN_LAIN[kunci];
    return undefined;
}

function itungNilaiEfektifSetelan(kunci, nilaiSimpenan) {
    const nilai = nilaiSimpenan[kunci];
    if (kunci === 'auto-download-youtube-mode' && !['video', 'audio'].includes(nilai)) return 'video';
    if (nilai !== undefined && nilai !== null && nilai !== '') return nilai;
    const bawaan = itungNilaiBawaanSetelan(kunci);
    if (bawaan !== undefined && bawaan !== null && bawaan !== '') return bawaan;
    const bawaanPilihan = NILAI_BAWAAN_PILIHAN[kunci];
    if (bawaanPilihan !== undefined) return bawaanPilihan;
    return undefined;
}

function golekElemenSetelan(akar, kunci) {
    if (akar) return akar.querySelector('#' + CSS.escape(kunci));
    return document.getElementById(kunci);
}

function terapnoNilaiAwalSetelan(nilaiSimpenan, akar) {
    for (const kunci of SETTINGS_KEYS) {
        const elemen = golekElemenSetelan(akar, kunci);
        if (!elemen) continue;
        if (elemen.tagName === 'MDUI-SWITCH') {
            let efektif = nilaiSimpenan[kunci];
            if (efektif === undefined) efektif = itungNilaiBawaanSetelan(kunci);
            elemen.checked = efektif === '1' || efektif === true;
            elemen.toggleAttribute('checked', elemen.checked);
            continue;
        }
        if (elemen.tagName === 'MDUI-SELECT' || elemen.tagName === 'SELECT' || elemen.tagName === 'MDUI-SEGMENTED-BUTTON-GROUP') {
            const efektif = itungNilaiEfektifSetelan(kunci, nilaiSimpenan);
            if (efektif !== undefined) elemen.value = efektif;
            continue;
        }
        if (elemen.tagName === 'TEXTAREA' || elemen.tagName === 'MDUI-TEXT-FIELD' || (elemen.tagName === 'INPUT' && (elemen.type === 'text' || elemen.type === 'number'))) {
            const defVal = ['limit-media-list-custom', 'image-min-file-size-custom'].includes(kunci) ? '0' : (kunci === 'image-min-side-custom' ? '512' : '');
            const efektif = itungNilaiEfektifSetelan(kunci, nilaiSimpenan);
            elemen.value = (efektif !== undefined && efektif !== null && efektif !== '') ? efektif : defVal;
            continue;
        }
    }
    const pilihLokasi = akar ? akar.querySelector('#cloud-save-location') : document.getElementById('cloud-save-location');
    let lokasi = 'local';
    if (nilaiSimpenan['save-to-gdrive'] === '1') lokasi = 'gdrive';
    if (nilaiSimpenan['save-to-dropbox'] === '1') lokasi = 'dropbox';
    if (pilihLokasi && pilihLokasi.value !== lokasi) pilihLokasi.value = lokasi;
    const rincianGdrive = akar ? akar.querySelector('#gdrive-details-container') : document.getElementById('gdrive-details-container');
    const rincianDropbox = akar ? akar.querySelector('#dropbox-details-container') : document.getElementById('dropbox-details-container');
    if (rincianGdrive) rincianGdrive.style.display = lokasi === 'gdrive' ? 'flex' : 'none';
    if (rincianDropbox) rincianDropbox.style.display = lokasi === 'dropbox' ? 'flex' : 'none';
}

let settingsPageInitPromise = null;

let pendingChanges = {};
let isInitializing = false;
