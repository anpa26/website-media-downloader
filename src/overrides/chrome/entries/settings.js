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

if (typeof browser === 'undefined') {
    var browser = chrome;
}

const URUTAN_MODUL_PENGATURAN = [
    'settings/state.js',
    'settings/notif.js',
    'settings/tampilan/tema.js',
    'settings/perawatan/ekspor.js',
    'settings/perawatan/debug.js',
    'settings/perawatan/cache-indexeddb.js',
    'settings/tampilan/konfirmasi.js',
    'settings/pengaturan.js',
    'settings/tampilan/tata-letak.js',
    'settings/alat/speedtest.js',
    'settings/boot.js',
];

let janjiMuatModulPengaturan = null;

function muatModulPengaturan() {
    let rantai = Promise.resolve();
    for (const modul of URUTAN_MODUL_PENGATURAN) {
        rantai = rantai.then(() => new Promise((resolve, reject) => {
            const skrip = document.createElement('script');
            skrip.async = false;
            skrip.src = browser.runtime.getURL(modul);
            skrip.onload = () => resolve();
            skrip.onerror = () => reject(new Error('Failed to load script ' + modul));
            document.head.appendChild(skrip);
        }));
    }
    return rantai;
}

window.initializeSettingsPage = function initializeSettingsPage() {
    if (!janjiMuatModulPengaturan) janjiMuatModulPengaturan = muatModulPengaturan();
    return janjiMuatModulPengaturan.then(() => window.__initSettingsPageAsli());
};
