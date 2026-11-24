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

window.mdu_translate = function(akar) {
    const wadah = akar || document;
    wadah.querySelectorAll('[data-translate], [data-helper-translate], [data-title-translate], [data-placeholder-translate], [data-label-translate]').forEach(element => {
        const kunciTeks = element.getAttribute('data-translate');
        if (kunciTeks !== null) {
            const terjemahanTeks = browser.i18n.getMessage(kunciTeks);
            if (terjemahanTeks) {
                element.textContent = terjemahanTeks;
            }
            else {
                console.warn(`Missing translation for key: ${kunciTeks}`);
            }
        }
        const kunciPambiyantu = element.getAttribute('data-helper-translate');
        if (kunciPambiyantu !== null) {
            const terjemahanPambiyantu = browser.i18n.getMessage(kunciPambiyantu);
            if (terjemahanPambiyantu) {
                element.setAttribute('helper', terjemahanPambiyantu);
            }
        }
        const kunciJudhul = element.getAttribute('data-title-translate');
        if (kunciJudhul !== null) {
            const terjemahanJudhul = browser.i18n.getMessage(kunciJudhul);
            if (terjemahanJudhul) {
                element.setAttribute('title', terjemahanJudhul);
                element.setAttribute('aria-label', terjemahanJudhul);
            }
        }
        const kunciPanggonan = element.getAttribute('data-placeholder-translate');
        if (kunciPanggonan !== null) {
            const terjemahanPanggonan = browser.i18n.getMessage(kunciPanggonan);
            if (terjemahanPanggonan) {
                element.setAttribute('placeholder', terjemahanPanggonan);
            }
        }
        const kunciTetenger = element.getAttribute('data-label-translate');
        if (kunciTetenger !== null) {
            const terjemahanTetenger = browser.i18n.getMessage(kunciTetenger);
            if (terjemahanTetenger) {
                element.setAttribute('label', terjemahanTetenger);
            }
        }
    });
};

document.addEventListener('DOMContentLoaded', () => {
    window.mdu_translate();
});
