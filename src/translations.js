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

document.addEventListener('DOMContentLoaded', () => {

    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        const translation = browser.i18n.getMessage(key);
        if (translation) {
            element.textContent = translation;
        }
        else {
            console.warn(`Missing translation for key: ${key}`);
        }
    });

    document.querySelectorAll('[data-helper-translate]').forEach(element => {
        const key = element.getAttribute('data-helper-translate');
        const translation = browser.i18n.getMessage(key);
        if (translation) {
            element.setAttribute('helper', translation);
        }
    });

    document.querySelectorAll('[data-title-translate]').forEach(element => {
        const key = element.getAttribute('data-title-translate');
        const translation = browser.i18n.getMessage(key);
        if (translation) {
            element.setAttribute('title', translation);
        }
    });

    document.querySelectorAll('[data-placeholder-translate]').forEach(element => {
        const key = element.getAttribute('data-placeholder-translate');
        const translation = browser.i18n.getMessage(key);
        if (translation) {
            element.setAttribute('placeholder', translation);
        }
    });

    document.querySelectorAll('[data-label-translate]').forEach(element => {
        const key = element.getAttribute('data-label-translate');
        const translation = browser.i18n.getMessage(key);
        if (translation) {
            element.setAttribute('label', translation);
        }
    });
});
