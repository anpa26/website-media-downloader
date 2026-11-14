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

    if (!window.mdu_detector_injected) {

    safeStorageGet(contentStorageKeys).then((result) => {
        cachedContentSettings = result;
        const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
        isGlobalOpt = isOpt;

        syncDetectionState();
        if (contentDetectionEnabled(result) && documentScanEnabled(result)) window.mdu_scan();
    }).catch(() => {});

    try {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && contentStorageKeys.some(key => Object.prototype.hasOwnProperty.call(changes, key))) {
                for (const [key, change] of Object.entries(changes)) cachedContentSettings[key] = change.newValue;
                syncDetectionState();
                if (contentDetectionEnabled() && documentScanEnabled()) window.mdu_scan();
            }
        });
    } catch(e) {}
    }
