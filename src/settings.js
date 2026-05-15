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
        'url-detection', 'mime-detection', 'detect-download-links', 'hide-segments',
        'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file',
        'media-notification', 'download-method', 'media-cache', 'speed-boost', 'connections', 'stream-download',
        'stream-quality', 'mpd-fix', 'background-download', 'open-preference',
        'filename-template', 'disable-rename-dialog', 'history-page'
    ];

    for (const setting of settings) {
        const result = await browser.storage.local.get(setting);
        let value = result[setting];

        if (value === undefined) {
            const defaultsEnabled = [
                'url-detection', 'mime-detection', 'history-page',
                'media-notification', 'only-video', 'only-audio', 'only-stream',
                'background-download', 'only-file'
            ];
            if (defaultsEnabled.includes(setting)) {
                value = '1';
                browser.storage.local.set({ [setting]: value });
            }

            if (['only-image', 'only-subtitle', 'detect-download-links'].includes(setting)) {
                value = '0';
                browser.storage.local.set({ [setting]: value });
            }
            if (setting === 'speed-boost' || setting === 'disable-rename-dialog') {
                value = '0';
                browser.storage.local.set({ [setting]: value });
            }
            if (setting === 'connections') {
                value = '4';
                browser.storage.local.set({ [setting]: value });
            }
        }

        const element = document.getElementById(setting);
        if (element && element.tagName === 'MDUI-SWITCH') {
            element.checked = value === '1' || value === true;
            element.addEventListener('change', () => {
                browser.storage.local.set({ [setting]: element.checked ? '1' : '0' });

                if (setting === 'background-download') {
                    syncNotificationSetting(element.checked);
                }
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

            group.value = activeValue;

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

            setTimeout(() => updateSelection(activeValue), 50);

            group.addEventListener('change', () => {
                const newVal = group.value;
                if (newVal) {
                    browser.storage.local.set({ [setting]: newVal });
                    updateSelection(newVal);
                    if (setting === 'open-preference') updatePopupState(newVal);
                } else {

                    group.value = activeValue;
                    updateSelection(activeValue);
                }
            });

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

    const autoGenBtn = document.getElementById('auto-generate-template');
    const filenameInput = document.getElementById('filename-template');
    const disableRenameSwitch = document.getElementById('disable-rename-dialog');

    const updateDisableRenameState = () => {

        if (disableRenameSwitch) {
            disableRenameSwitch.disabled = false;
        }
    };

    if (filenameInput) {
        filenameInput.addEventListener('input', updateDisableRenameState);

        setTimeout(updateDisableRenameState, 100);
    }

    if (autoGenBtn && filenameInput) {
        autoGenBtn.addEventListener('click', () => {
            const defaultTemplate = "{title} - {name}";
            filenameInput.value = defaultTemplate;
            browser.storage.local.set({ 'filename-template': defaultTemplate });
            updateDisableRenameState();

            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({
                    message: browser.i18n.getMessage("settingsTemplateAutoGenerated", [defaultTemplate]),
                    placement: "top"
                });
            }
        });
    }

    const colorInput = document.getElementById('color-picker-input');
    const applyColorBtn = document.getElementById('apply-color-button');
    const presets = document.querySelectorAll('.color-preset');
    const openSettingsTabBtn = document.getElementById('open-settings-tab');

    if (colorInput) {
        const activeColor = colorResult['theme-color'] || '#bbdefb';
        colorInput.value = activeColor;
        mdui.setColorScheme(activeColor);

        const updateActivePreset = (color) => {
            presets.forEach(p => {
                if (p.dataset.color.toLowerCase() === color.toLowerCase()) {
                    p.classList.add('active');
                } else {
                    p.classList.remove('active');
                }
            });
        };
        updateActivePreset(activeColor);

        const saveColor = (newColor) => {
            browser.storage.local.set({ 'theme-color': newColor });
            mdui.setColorScheme(newColor);
            updateActivePreset(newColor);
        };

        colorInput.addEventListener('input', (e) => {
            saveColor(e.target.value);
        });

        colorInput.addEventListener('change', (e) => {
            saveColor(e.target.value);
        });

        if (applyColorBtn) {
            applyColorBtn.addEventListener('click', () => {
                saveColor(colorInput.value);
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    mdui.snackbar({
                        message: browser.i18n.getMessage("themeColorApplied"),
                        placement: "top"
                    });
                }
            });
        }

        presets.forEach(preset => {
            preset.addEventListener('click', () => {
                const color = preset.dataset.color;
                colorInput.value = color;
                saveColor(color);
            });
        });

        if (openSettingsTabBtn) {
            openSettingsTabBtn.addEventListener('click', () => {
                browser.tabs.create({ url: 'popup.html?options=true' });
            });
        }
    }

    const bgDlSwitch = document.getElementById('background-download');
    if (bgDlSwitch) {
        syncNotificationSetting(bgDlSwitch.checked);
    }
}

function syncNotificationSetting(isBgEnabled) {
    const notificationSwitch = document.getElementById('media-notification');
    if (!notificationSwitch) return;

    if (!isBgEnabled) {

        notificationSwitch.checked = false;
        notificationSwitch.disabled = true;
        browser.storage.local.set({ 'media-notification': '0' });
    } else {

        notificationSwitch.disabled = false;
    }
}

function updatePopupState(value) {
    if (value === 'popup') {
        browser.action.setPopup({ popup: 'popup.html' });
    } else {
        browser.action.setPopup({ popup: '' });
    }
}
