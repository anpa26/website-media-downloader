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



async function bukakPengelolaUnduhan() {
    const urlPengelola = browser.runtime.getURL('pages/download.html');
    try {
        const kabehTab = await browser.tabs.query({});
        for (const tab of kabehTab || []) {
            if (!tab.url || !tab.url.startsWith(urlPengelola)) continue;
            await browser.tabs.update(tab.id, { active: true });
            if (tab.windowId !== undefined && browser.windows && typeof browser.windows.update === 'function') {
                await browser.windows.update(tab.windowId, { focused: true });
            }
            return;
        }
    } catch (_) {}
    await browser.tabs.create({ url: urlPengelola });
}

function setupDownloadManagerControls() {
    const tombolBukak = document.getElementById('open-download-manager');
    if (!tombolBukak || tombolBukak.dataset.ready === '1') return;
    tombolBukak.dataset.ready = '1';
    tombolBukak.addEventListener('click', async () => {
        try {
            await bukakPengelolaUnduhan();
        } catch (galat) {
            if (typeof mdui !== 'undefined' && mdui.snackbar) tampilnoNotif(galat && galat.message ? galat.message : String(galat));
        }
    });
}
