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


window.__initSettingsPageAsli = function initializeSettingsPage() {
  if (settingsPageInitPromise) return settingsPageInitPromise;
  settingsPageInitPromise = (async () => {
    await initTheme();

    const cloudLocationSelect = document.getElementById('cloud-save-location');
    const gdriveDetails = document.getElementById('gdrive-details-container');
    const dropboxDetails = document.getElementById('dropbox-details-container');

        async function updateCloudVisibility() {
        const res = await browser.storage.local.get(['save-to-gdrive', 'save-to-dropbox']);
        let gdriveVal = pendingChanges['save-to-gdrive'] !== undefined ? pendingChanges['save-to-gdrive'] : res['save-to-gdrive'];
        let dropboxVal = pendingChanges['save-to-dropbox'] !== undefined ? pendingChanges['save-to-dropbox'] : res['save-to-dropbox'];

        let val = 'local';
        if (gdriveVal === '1') val = 'gdrive';
        if (dropboxVal === '1') val = 'dropbox';

        if (cloudLocationSelect) {
            if (cloudLocationSelect.value !== val) {
                cloudLocationSelect.value = val;
            }
        }

        const gdriveStream = document.getElementById('gdrive-stream');
        const dropboxStream = document.getElementById('dropbox-stream');

        if (gdriveStream) {
            gdriveStream.disabled = val !== 'gdrive';
            if (gdriveStream.disabled && gdriveStream.checked) {
                gdriveStream.checked = false;
                gdriveStream.dispatchEvent(new Event('change'));
            }
        }
        if (dropboxStream) {
            dropboxStream.disabled = val !== 'dropbox';
            if (dropboxStream.disabled && dropboxStream.checked) {
                dropboxStream.checked = false;
                dropboxStream.dispatchEvent(new Event('change'));
            }
        }

        if (val === 'gdrive') {
            if (gdriveDetails) gdriveDetails.style.display = 'flex';
            if (dropboxDetails) dropboxDetails.style.display = 'none';
        } else if (val === 'dropbox') {
            if (gdriveDetails) gdriveDetails.style.display = 'none';
            if (dropboxDetails) dropboxDetails.style.display = 'flex';
        } else {
            if (gdriveDetails) gdriveDetails.style.display = 'none';
            if (dropboxDetails) dropboxDetails.style.display = 'none';
        }
    }

    if (cloudLocationSelect) {
        cloudLocationSelect.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (val === 'local') {
                pendingChanges['save-to-gdrive'] = '0';
                pendingChanges['save-to-dropbox'] = '0';
            } else if (val === 'gdrive') {
                pendingChanges['save-to-gdrive'] = '1';
                pendingChanges['save-to-dropbox'] = '0';
            } else if (val === 'dropbox') {
                pendingChanges['save-to-gdrive'] = '0';
                pendingChanges['save-to-dropbox'] = '1';
            }
            if (typeof showApplyBar === 'function') showApplyBar();
            updateCloudVisibility();
        });
    }

    updateCloudVisibility();

    await Promise.allSettled([
        customElements.whenDefined('mdui-switch'),
        customElements.whenDefined('mdui-segmented-button-group'),
        customElements.whenDefined('mdui-segmented-button')
    ]);
    await initializeSettings();
    setupConfirmationBar();
    // LIGHT_EXCLUDE_SPEED_TEST_START
    setupSpeedTest();
    // LIGHT_EXCLUDE_SPEED_TEST_END
    setupIndexedDBCacheControls();
    setupSettingsConfigurationControls();
    // DEBUG_ONLY_START
    setupDebugLogControls();
    // DEBUG_ONLY_END
    setupManualTsConverter();

    if (window.location.search.includes('startDropbox=true')) {
        const res = await browser.storage.local.get('dropbox_token');
        if (!res.dropbox_token) {
            const dropboxBtn = document.getElementById('dropbox-login-btn');
            if (dropboxBtn) dropboxBtn.click();
        }
    }

    if (window.location.search.includes('startGDrive=true')) {
        const res = await browser.storage.local.get('gdrive_token');
        if (!res.gdrive_token) {
            const gdriveBtn = document.getElementById('gdrive-login-btn');
            if (gdriveBtn) gdriveBtn.click();
        }
    }
  })();
  return settingsPageInitPromise;
};
