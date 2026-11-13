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



function setupConfirmationBar() {
    const bar = document.getElementById('settings-apply-bar');
    const applyBtn = document.getElementById('apply-settings');
    const cancelBtn = document.getElementById('cancel-settings');

    if (!bar || !applyBtn || !cancelBtn) return;

    applyBtn.addEventListener('click', async () => {
        if (Object.keys(pendingChanges).length === 0) return;
        applyBtn.loading = true;
        applyBtn.disabled = true;
        try {
            await browser.storage.local.set({ ...pendingChanges });
            pendingChanges = {};
            bar.style.display = 'none';
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(browser.i18n.getMessage('settingsSaved') || 'Settings saved');
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            applyBtn.loading = false;
            applyBtn.disabled = false;
        }
    });

    cancelBtn.addEventListener('click', () => {
        pendingChanges = {};
        bar.style.display = 'none';
        initializeSettings();
    });
}

function showApplyBar() {
    if (isInitializing) return;
    const bar = document.getElementById('settings-apply-bar');
    if (bar) bar.style.display = 'flex';
}

function fitPillSelectToSelectedOption(select) {
    if (!(select instanceof HTMLSelectElement) || !select.classList.contains('pill-select') || select.closest('.dynamic-resolution-row')) return;
    const selectedOption = select.selectedOptions[0];
    if (!selectedOption) return;

    const style = getComputedStyle(select);
    const canvas = fitPillSelectToSelectedOption.canvas || (fitPillSelectToSelectedOption.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = style.font;
    const textWidth = context.measureText(selectedOption.textContent.trim()).width;
    const horizontalSpace = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
        .reduce((total, property) => total + (parseFloat(style[property]) || 0), 0);
    const minimumWidth = parseFloat(style.minWidth) || 0;
    select.style.width = `${Math.ceil(Math.max(minimumWidth, textWidth + horizontalSpace))}px`;
}

document.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement) fitPillSelectToSelectedOption(event.target);
});
