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



function showAddManualUrlDialog() {
    return new Promise(async (resolve) => {
        const dialog = document.createElement('mdui-dialog');
        dialog.headline = browser.i18n.getMessage("addManualUrlHeadline") || "Add URL to Download";

        const urlField = document.createElement('mdui-text-field');
        urlField.style.marginTop = '16px';
        urlField.setAttribute('label', browser.i18n.getMessage("addManualUrlFieldLabel") || "Direct File URL");
        urlField.setAttribute('placeholder', "https://example.com/file.mp4");
        dialog.appendChild(urlField);

        const cancelBtn = document.createElement('mdui-button');
        cancelBtn.slot = "action";
        cancelBtn.variant = "text";
        cancelBtn.textContent = browser.i18n.getMessage("renameDialogCancelButton") || "Cancel";
        cancelBtn.addEventListener('click', () => {
            dialog.open = false;
            resolve(null);
        });

        const okBtn = document.createElement('mdui-button');
        okBtn.slot = "action";
        okBtn.variant = "tonal";
        okBtn.textContent = browser.i18n.getMessage("renameDialogDownloadButton") || "Download";
        okBtn.addEventListener('click', () => {
            dialog.open = false;
            resolve(urlField.value.trim());
        });

        dialog.appendChild(cancelBtn);
        dialog.appendChild(okBtn);

        document.body.appendChild(dialog);
        dialog.open = true;

        dialog.addEventListener('closed', () => {
            dialog.remove();
        });
    });
}

async function addManualUrl(url) {
    if (!url) return;
    try {
        const parsedManualUrl = new URL(url);
        if (parsedManualUrl.protocol !== 'http:' && parsedManualUrl.protocol !== 'https:') throw new Error('Skema URL ora didukung');
    } catch (e) {
        showDialog("Please enter a valid URL.", "Invalid URL");
        return;
    }

    let activeTabId = null;
    let activeTabUrl = "";
    let activeTabTitle = "";
    try {
        const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs && tabs[0]) {
            activeTabId = tabs[0].id;
            activeTabUrl = tabs[0].url;
            activeTabTitle = tabs[0].title;
        }
    } catch (e) {}

    const originalName = getFileName(url, 100);
    const item = {
        url: url,
        method: 'GET',
        requestHeaders: null,
        responseHeaders: null,
        requestBody: null,
        cookie: '',
        size: 'unknown',
        timeStamp: Date.now(),
        tabId: activeTabId,
        pageTitle: originalName,
        pageUrl: activeTabUrl,
        isManual: true
    };

    const updates = {};
    updates[url] = [item];
    await browser.storage.session.set(updates);

    const loadingSpinner = document.getElementById('loading-media-list');
    if (loadingSpinner) loadingSpinner.style.display = 'block';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            credentials: 'include'
        });
        clearTimeout(timeoutId);
        if (response.body) {
            response.body.getReader().cancel().catch(() => {});
        }
    } catch (e) {
        console.warn("Manual URL probing fetch aborted or failed:", e);
    }

    await loadMediaList();

    setTimeout(async () => {
        const mediaItemEl = Array.from(document.querySelectorAll('.media-item')).find(el => {
            return el.dataset.url === url;
        });
        if (mediaItemEl) {
            const dlBtn = mediaItemEl.querySelector('#download-button');
            if (dlBtn) dlBtn.click();
        } else {
            downloadFile(url, null, null, false);
        }
    }, 300);
}
