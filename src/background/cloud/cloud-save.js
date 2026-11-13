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

async function processSaveQueue() {
    if (pendingSaveQueue.length === 0) return;

    const isAndroid = /Android/i.test(navigator.userAgent);

    // The bridge page is the primary save mechanism on Android. Desktop must
    // try the browser download manager for every file before using the page as
    // a fallback, even when an older fallback tab is still open.
    if (activeBridgeTabId !== null && isAndroid) {
        const nextDownload = pendingSaveQueue.shift();
        try {
            await browser.tabs.sendMessage(activeBridgeTabId, {
                action: 'startDownload',
                id: nextDownload.id,
                url: nextDownload.url,
                filename: nextDownload.filename
            });
            setTimeout(processSaveQueue, 100);
        } catch (err) {
            pendingSaveQueue.unshift(nextDownload);
            activeBridgeTabId = null;
            setTimeout(processSaveQueue, 500);
        }
        return;
    }

    const nextDownload = pendingSaveQueue.shift();
    const { id, url, filename, isStreamUploaded, cloud } = nextDownload;

    const settings = await browser.storage.local.get(['save-to-gdrive', 'save-to-dropbox']);
    if (settings['save-to-gdrive'] === '1' || settings['save-to-dropbox'] === '1' || cloud) {
        if (isStreamUploaded) {
            browser.runtime.sendMessage({
                action: 'downloadComplete',
                id: id,
                url: url,
                filename: filename,
                cloud: true
            }).catch(() => {});

            activeDownloads.delete(id);
            removeDownloadState(id);
            removeMediaRequest(url);

            setTimeout(processSaveQueue, 1000);
            return;
        }

        try {
            const activeItem = activeDownloads.get(id);
            if (activeItem) {
                activeItem.status = 'uploading';
            }

            browser.runtime.sendMessage({
                action: 'downloadProgress',
                id: id,
                loaded: 0,
                percent: 0,
                status: 'uploading'
            }).catch(() => {});

            if (settings['save-to-gdrive'] === '1') { await uploadFromCacheToGDrive(id, filename); } else if (settings['save-to-dropbox'] === '1') { await uploadFromCacheToDropbox(id, filename); } else { throw new Error('Cloud save not enabled'); }

            browser.runtime.sendMessage({
                action: 'downloadComplete',
                id: id,
                url: url,
                filename: filename,
                cloud: true
            }).catch(() => {});

            activeDownloads.delete(id);
            removeDownloadState(id);
            removeMediaRequest(url);

            setTimeout(processSaveQueue, 1000);
            return;
        } catch (error) {
            console.error("GDrive upload failed, falling back to local download:", error);
        }
    }

    const hiddenSuccess = await triggerHiddenDownload(id, filename);
    if (hiddenSuccess) {
        activeDownloads.delete(id);
        removeDownloadState(id);
        removeMediaRequest(url);
        browser.runtime.sendMessage({ action: 'downloadComplete', id: id, url: url }).catch(() => {});

        setTimeout(processSaveQueue, 1000);
        return;
    }

    const tab = await browser.tabs.create({
        url: browser.runtime.getURL(`pages/download.html?id=${id}&url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`),
        active: isAndroid
    });
    activeBridgeTabId = tab.id;
}

browser.tabs.onRemoved.addListener((tabId) => {
    if (downloadTabs.has(tabId)) {
        const dlIds = downloadTabs.get(tabId);
        if (dlIds instanceof Set) {
            for (const dlId of dlIds) {
                cleanupDownload(dlId);
            }
        } else if (dlIds) {
            cleanupDownload(dlIds);
        }
        downloadTabs.delete(tabId);
    }

    if (tabId === activeBridgeTabId) {
        activeBridgeTabId = null;
        setTimeout(processSaveQueue, 1000);
    }
});
