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
    setupConfirmationBar();
});

let pendingChanges = {};

function setupConfirmationBar() {
    const bar = document.getElementById('settings-apply-bar');
    const applyBtn = document.getElementById('apply-settings');
    const cancelBtn = document.getElementById('cancel-settings');

    if (!bar || !applyBtn || !cancelBtn) return;

    applyBtn.addEventListener('click', async () => {
        if (Object.keys(pendingChanges).length === 0) return;

        // Save current tab and scroll position before reload
        const navbar = document.getElementById('navbar');
        if (navbar && typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('activeTab', navbar.value);
            sessionStorage.setItem('scrollPos', window.scrollY);
        }

        await browser.storage.local.set(pendingChanges);
        
        // No need to manually update theme or popup state here as reload will handle it
        location.reload();
    });

    cancelBtn.addEventListener('click', () => {
        pendingChanges = {};
        bar.style.display = 'none';
        initializeSettings(); // Re-sync UI with actual storage
    });
}

function showApplyBar() {
    const bar = document.getElementById('settings-apply-bar');
    if (bar) bar.style.display = 'flex';
}

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
                'url-detection', 'mime-detection',
                'media-notification', 'only-video', 'only-audio', 'only-stream',
                'background-download', 'only-file'
            ];
            if (defaultsEnabled.includes(setting)) {
                value = '1';
                browser.storage.local.set({ [setting]: value });
            }

            if (['only-image', 'only-subtitle', 'detect-download-links', 'history-page'].includes(setting)) {
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
        if (!element) continue;

        if (element.tagName === 'MDUI-SWITCH') {
            element.checked = value === '1' || value === true;
            element.onchange = () => {
                pendingChanges[setting] = element.checked ? '1' : '0';
                showApplyBar();

                if (setting === 'background-download') {
                    syncNotificationSetting(element.checked);
                }
            };
            continue;
        }

        if (element.tagName === 'MDUI-TEXT-FIELD') {
            element.value = value || '';
            element.oninput = () => {
                pendingChanges[setting] = element.value;
                showApplyBar();
            };
            continue;
        }

        if (element.tagName === 'MDUI-SELECT' || element.tagName === 'SELECT') {
            const defaultValue = setting === 'open-preference' ? 'tab' :
                                (setting === 'download-method' ? 'browser' :
                                (setting === 'stream-quality' ? 'highest' :
                                (setting === 'connections' ? '4' :
                                (setting === 'stream-download' ? 'offline' : 'stream'))));
            
            element.value = value || defaultValue;
            element.onchange = () => {
                pendingChanges[setting] = element.value;
                showApplyBar();
            };
            continue;
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
        autoGenBtn.onclick = () => {
            const defaultTemplate = "{title} - {name}";
            filenameInput.value = defaultTemplate;
            pendingChanges['filename-template'] = defaultTemplate;
            showApplyBar();
            updateDisableRenameState();

            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                mdui.snackbar({
                    message: browser.i18n.getMessage("settingsTemplateAutoGenerated", [defaultTemplate]),
                    placement: "top"
                });
            }
        };
    }

    const presets = document.querySelectorAll('.color-preset');
    const hexInput = document.getElementById('color-hex-input');
    const openSettingsTabBtn = document.getElementById('open-settings-tab');

    const activeColor = colorResult['theme-color'] || '#bbdefb';
    mdui.setColorScheme(activeColor);
    if (hexInput) hexInput.value = activeColor;

    const updateActivePreset = (color) => {
        presets.forEach(p => {
            if (p.dataset.color && p.dataset.color.toLowerCase() === color.toLowerCase()) {
                p.classList.add('active');
            } else {
                p.classList.remove('active');
            }
        });
    };
    updateActivePreset(activeColor);

    const stageColor = (newColor) => {
        pendingChanges['theme-color'] = newColor;
        showApplyBar();
        mdui.setColorScheme(newColor);
        updateActivePreset(newColor);
    };

    if (hexInput) {
        hexInput.oninput = (e) => {
            let val = e.target.value;
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                stageColor(val);
            }
        };
    }

    presets.forEach(preset => {
        preset.onclick = () => {
            const color = preset.dataset.color;
            if (color) {
                if (hexInput) hexInput.value = color;
                stageColor(color);
            }
        };
    });

    if (openSettingsTabBtn) {
        openSettingsTabBtn.addEventListener('click', () => {
            browser.tabs.create({ url: 'popup.html?options=true' });
        });
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
