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
    const colorResult = await browser.storage.local.get('theme-color');
    mdui.setColorScheme(colorResult['theme-color'] || '#bbdefb');

    const urlParams = new URLSearchParams(window.location.search);
    const streamUrl = urlParams.get('url');
    const size = urlParams.get('size');
    const audioOnly = urlParams.get('audioOnly') === 'true';

    if (!streamUrl) {
        document.getElementById('status-header').textContent = browser.i18n.getMessage("downloadErrorTitle");
        document.getElementById('status-text').textContent = browser.i18n.getMessage("streamNoUrlError");
        return;
    }

    const loadingBar = document.getElementById('stream-progress');
    const statusHeader = document.getElementById('status-header');
    const statusText = document.getElementById('status-text');
    const mediaTitle = document.getElementById('media-title');
    const actionArea = document.getElementById('action-area');
    const closeButton = document.getElementById('close-button');

    closeButton.addEventListener('click', () => window.close());

    try {

        const mediaRequests = await browser.runtime.sendMessage({ action: 'getMediaRequests' });
        const requests = mediaRequests[streamUrl];

        if (!requests || requests.length === 0) {
            throw new Error("Request details not found in session storage.");
        }

        const request = requests.find(r => r.size === size) || requests[0];

        const urlParams = new URLSearchParams(window.location.search);
        const customFilename = urlParams.get('filename');
        mediaTitle.textContent = customFilename || getFileName(streamUrl);
        statusHeader.textContent = browser.i18n.getMessage("streamDownloadingTitle");

        const headers = request.requestHeaders || [];
        const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method'] || 'fetch');

        if (streamUrl.toLowerCase().includes('.m3u8')) {
            await downloadM3U8Offline(streamUrl, headers, downloadMethod, loadingBar, request, customFilename, audioOnly);
        } else if (streamUrl.toLowerCase().includes('.mpd')) {
            await downloadMPDOffline(streamUrl, headers, downloadMethod, loadingBar, request, customFilename);
        } else {
            throw new Error(browser.i18n.getMessage("audioExtractionNotSupported"));
        }

        statusHeader.textContent = browser.i18n.getMessage("streamDownloadCompleteTitle");
        statusText.textContent = browser.i18n.getMessage("streamDownloadSaved");
        loadingBar.value = 100;
        loadingBar.removeAttribute('indeterminate');
        actionArea.style.display = 'block';

    } catch (error) {
        console.error("Stream download failed:", error);
        statusHeader.textContent = browser.i18n.getMessage("downloadErrorTitle");
        statusText.textContent = error.message;
        loadingBar.style.display = 'none';
        actionArea.style.display = 'block';
    }
});

function getFileName(url, maxLength = 30) {
    try {
        let parsedUrl = new URL(url);
        let fileName = parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1).split('?')[0];
        fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        if (!fileName) fileName = parsedUrl.hostname;
        if (fileName.length > maxLength) fileName = fileName.substring(0, maxLength) + '…';
        return decodeURIComponent(fileName);
    } catch (e) { return browser.i18n.getMessage("defaultMediaName") || "Media File"; }
}

function showDialog(message, title) {
    mdui.alert({
        headline: title,
        description: message,
        confirmText: "OK"
    });
}
