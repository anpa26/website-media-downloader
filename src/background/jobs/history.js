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


async function addToHistory(item) {
    const result = await browser.storage.local.get('history-page');
    if (result['history-page'] !== '1') return;

    if (!item.mediaType) {
        item.mediaType = getMediaType(item.url, '');
    }

    const historyResult = await browser.storage.local.get('download-history');
    let history = historyResult['download-history'] || [];

    item.timestamp = item.timestamp || Date.now();

    const existingIndex = history.findIndex(h =>
        h.url === item.url ||
        (h.pageUrl === item.pageUrl && h.filename === item.filename)
    );

    if (existingIndex !== -1) {
        history.splice(existingIndex, 1);
    }

    history.unshift(item);
    if (history.length > 100) history = history.slice(0, 100);
    await browser.storage.local.set({ 'download-history': history });
}


async function autoUpdateHistoryLink(pageUrl, filename, newUrl, tabId) {
    const historyResult = await browser.storage.local.get('download-history');
    let history = historyResult['download-history'] || [];
    let updated = false;

    for (let i = 0; i < history.length; i++) {

        if (history[i].pageUrl === pageUrl && history[i].filename === filename) {
            if (history[i].url !== newUrl) {
                history[i].url = newUrl;
                history[i].timestamp = Date.now();

                const item = history.splice(i, 1)[0];
                history.unshift(item);
                updated = true;
            }
            break;
        }
    }

    if (updated) {
        await browser.storage.local.set({ 'download-history': history });
        if (tabId) {
            showSimpleToast(tabId, browser.i18n.getMessage("historyLinkUpdated") || "Link updated successfully.");
        }
    }
}

async function getAutomaticFilename(url, tabId, metadata = {}) {
    let pageTitle = metadata.pageTitle || tabMetadata.get(tabId)?.title || '';
    if (!pageTitle && tabId >= 0) {
        try { pageTitle = (await browser.tabs.get(tabId)).title || ''; } catch (_) {}
    }
    return mediaFilename.resolve(url, { ...metadata, pageTitle });
}

async function generateTemplateName(template, url, originalName, tabId) {
    let pageTitle = tabMetadata.get(tabId)?.title || '';
    if (!pageTitle && tabId >= 0) {
        try { pageTitle = (await browser.tabs.get(tabId)).title || ''; } catch (_) {}
    }
    return mediaFilename.template(template, url, originalName, pageTitle);
}
