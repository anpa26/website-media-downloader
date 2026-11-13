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



async function exportSettingsConfiguration() {
    const stored = await browser.storage.local.get(SETTINGS_KEYS);
    const settings = {};
    for (const key of SETTINGS_KEYS) if (Object.prototype.hasOwnProperty.call(stored, key)) settings[key] = stored[key];
    Object.assign(settings, pendingChanges);
    const payload = { format: SETTINGS_EXPORT_FORMAT, version: SETTINGS_EXPORT_VERSION, extensionVersion: browser.runtime.getManifest().version, exportedAt: new Date().toISOString(), settings };
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `wmd-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    showSettingsMessage('settingsExportSuccess', 'Settings exported successfully!');
}

async function importSettingsConfiguration(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
        const payload = JSON.parse(await file.text());
        if (!payload || payload.format !== SETTINGS_EXPORT_FORMAT || payload.version !== SETTINGS_EXPORT_VERSION || !payload.settings || Array.isArray(payload.settings) || typeof payload.settings !== 'object') throw new Error(browser.i18n.getMessage('settingsImportInvalidFormat') || 'Invalid settings file format');
        const imported = {};
        for (const key of SETTINGS_KEYS) if (Object.prototype.hasOwnProperty.call(payload.settings, key)) imported[key] = payload.settings[key];
        if (Object.keys(imported).length === 0) throw new Error(browser.i18n.getMessage('settingsImportNoSettings') || 'The file contains no supported settings');
        await browser.storage.local.set(imported);
        pendingChanges = {};
        const applyBar = document.getElementById('settings-apply-bar');
        if (applyBar) applyBar.style.display = 'none';
        showSettingsMessage('settingsImportSuccess', 'Settings imported successfully!');
        setTimeout(() => window.location.reload(), 700);
    } catch (error) {
        showSettingsMessage('settingsImportError', `Failed to import settings: ${error.message}`, [error.message]);
    }
}

function setupSettingsConfigurationControls() {
    const exportButton = document.getElementById('export-settings');
    const importButton = document.getElementById('import-settings');
    const importInput = document.getElementById('import-settings-input');
    if (!exportButton || !importButton || !importInput || exportButton.dataset.ready === '1') return;
    exportButton.dataset.ready = '1';
    exportButton.addEventListener('click', () => exportSettingsConfiguration().catch(error => showSettingsMessage('settingsExportError', `Failed to export settings: ${error.message}`, [error.message])));
    importButton.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', importSettingsConfiguration);
}
