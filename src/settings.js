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

document.addEventListener('DOMContentLoaded', async () => {
    await Promise.allSettled([
        customElements.whenDefined('mdui-switch'),
        customElements.whenDefined('mdui-segmented-button-group'),
        customElements.whenDefined('mdui-segmented-button')
    ]);
    initializeSettings();
});

async function initializeSettings() {
    const settings = [
        'url-detection', 'mime-detection', 'hide-segments', 'only-media',
        'media-notification', 'download-method', 'media-cache', 'speed-boost', 'connections', 'stream-download',
        'stream-quality', 'mpd-fix', 'open-preference',
        'filename-template', 'history-page'
    ];

    for (const setting of settings) {
        const result = await browser.storage.local.get(setting);
        let value = result[setting];

        // Default values for new settings
        if (value === undefined) {
            if (['url-detection', 'mime-detection', 'only-media', 'history-page', 'media-notification'].includes(setting)) {
                value = '1';
                browser.storage.local.set({ [setting]: value });
            }
            if (setting === 'speed-boost') {
                value = '0'; // Default off
                browser.storage.local.set({ [setting]: value });
            }
            if (setting === 'connections') {
                value = '4'; // Default 4 connections
                browser.storage.local.set({ [setting]: value });
            }
        }

        const element = document.getElementById(setting);
        if (element && element.tagName === 'MDUI-SWITCH') {
            element.checked = value === '1' || value === true;
            element.addEventListener('change', () => {
                browser.storage.local.set({ [setting]: element.checked ? '1' : '0' });
            });
            continue;
        }

        if (element && element.tagName === 'MDUI-TEXT-FIELD') {
            element.value = value || '';
            element.addEventListener('input', () => {
                browser.storage.local.set({ [setting]: element.value });
            });
            continue;
        }

        const group = document.getElementById(setting + '-group');
        if (group) {
            const defaultValue = setting === 'open-preference' ? 'tab' : 
                                (setting === 'download-method' ? 'browser' : 
                                (setting === 'stream-quality' ? 'highest' : 
                                (setting === 'connections' ? '4' : 
                                (setting === 'stream-download' ? 'offline' : 'stream'))));
            const activeValue = value || defaultValue;
            
            // Atur nilai grup
            group.value = activeValue;
            
            // Fungsi untuk update tampilan selected secara manual
            const updateSelection = (val) => {
                const buttons = group.querySelectorAll('mdui-segmented-button');
                buttons.forEach(btn => {
                    if (btn.value === val) {
                        btn.setAttribute('selected', '');
                        btn.selected = true;
                    } else {
                        btn.removeAttribute('selected');
                        btn.selected = false;
                    }
                });
            };

            // Jalankan sinkronisasi awal
            setTimeout(() => updateSelection(activeValue), 50);

            // Gunakan 'change' event untuk menangkap perubahan klik tunggal
            group.addEventListener('change', () => {
                const newVal = group.value;
                if (newVal) {
                    browser.storage.local.set({ [setting]: newVal });
                    updateSelection(newVal);
                    if (setting === 'open-preference') updatePopupState(newVal);
                } else {
                    // Jika klik yang sama (unselect), paksa balik ke nilai lama
                    group.value = activeValue; 
                    updateSelection(activeValue);
                }
            });
            
            // Backup listener untuk memastikan klik pertama selalu bereaksi
            group.addEventListener('click', (e) => {
                const btn = e.target.closest('mdui-segmented-button');
                if (btn) {
                    const clickedVal = btn.value;
                    group.value = clickedVal;
                    browser.storage.local.set({ [setting]: clickedVal });
                    updateSelection(clickedVal);
                    if (setting === 'open-preference') updatePopupState(clickedVal);
                }
            });
        }
    }

    const colorResult = await browser.storage.local.get('theme-color');

    // Filename template auto-generator
    const autoGenBtn = document.getElementById('auto-generate-template');
    const filenameInput = document.getElementById('filename-template');
    if (autoGenBtn && filenameInput) {
        autoGenBtn.addEventListener('click', () => {
            const defaultTemplate = "{title} - {name}";
            filenameInput.value = defaultTemplate;
            browser.storage.local.set({ 'filename-template': defaultTemplate });
            
            // Show a brief snackbar feedback if mdui is available
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({
                    message: "Template auto-generated: " + defaultTemplate,
                    placement: "top"
                });
            }
        });
    }

    const colorInput = document.getElementById('color-picker-input');
    if (colorInput) {
        const activeColor = colorResult['theme-color'] || '#bbdefb';
        colorInput.value = activeColor;
        mdui.setColorScheme(activeColor);
        
        colorInput.addEventListener('input', (e) => {
            const newColor = e.target.value;
            browser.storage.local.set({ 'theme-color': newColor });
            mdui.setColorScheme(newColor);
        });
    }
}

function updatePopupState(value) {
    if (value === 'popup') {
        browser.action.setPopup({ popup: 'popup.html' });
    } else {
        browser.action.setPopup({ popup: '' });
    }
}
