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


async function initTheme() {
    const result = await browser.storage.local.get(['theme-color', 'theme-mode']);
    const themeColor = result['theme-color'] || '#bbdefb';
    const themeMode = result['theme-mode'] || 'auto';

    if (typeof mdui !== 'undefined' && mdui.setColorScheme) {
        mdui.setColorScheme(themeColor);
    }

    const htmlEl = document.documentElement;
    htmlEl.classList.remove('mdui-theme-auto', 'mdui-theme-light', 'mdui-theme-dark', 'theme-pitch-black');

    if (themeMode === 'auto') {
        htmlEl.classList.add('mdui-theme-auto');
    } else if (themeMode === 'light') {
        htmlEl.classList.add('mdui-theme-light');
    } else if (themeMode === 'dark') {
        htmlEl.classList.add('mdui-theme-dark');
    } else if (themeMode === 'pitch-black') {
        htmlEl.classList.add('mdui-theme-dark');
        htmlEl.classList.add('theme-pitch-black');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await initTheme();
    const colorResult = await browser.storage.local.get('ui-scale');
    document.documentElement.style.zoom = colorResult['ui-scale'] || '85%';

    browser.storage.onChanged.addListener((changes) => {
        if (changes['theme-color'] || changes['theme-mode']) {
            initTheme();
        }
        if (changes['ui-scale']) {
            document.documentElement.style.zoom = changes['ui-scale'].newValue || '85%';
        }
    });

    browser.runtime.sendMessage({ action: 'registerDownloadManagerTab' }).catch(() => {});

    let stored = await getStoredDownloads();

    const urlParams = new URLSearchParams(window.location.search);
    const initialId = urlParams.get('id');
    const initialUrl = urlParams.get('url');
    const initialFilename = urlParams.get('filename') || browser.i18n.getMessage("defaultMediaName");

    if (initialId && initialUrl) {
        if (!stored.some(item => item.id === initialId)) {
            stored.push({ id: initialId, url: initialUrl, filename: initialFilename });
            await saveStoredDownloads(stored);
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (stored.length > 0) {
        for (const item of stored) {
            addNewDownload(item.id, item.url, item.filename);
        }
    }

    updateSaveAllZipVisibility();

    const saveAllZipBtn = document.getElementById('save-all-zip');
    if (saveAllZipBtn) {
        saveAllZipBtn.onclick = async () => {
            saveAllZipBtn.disabled = true;

            const checkedBoxes = Array.from(document.querySelectorAll('.card-select-checkbox')).filter(cb => cb.checked);
            const selectedIds = checkedBoxes.map(cb => cb.dataset.id);
            const isSelectedMode = selectedIds.length > 0;

            const originalText = saveAllZipBtn.textContent;
            saveAllZipBtn.textContent = isSelectedMode ? "Preparing Selected ZIP..." : "Preparing ZIP...";

            try {
                await ensureScriptLoaded('libraries/client-zip.js', 'downloadZip');
                let stored = await getStoredDownloads();
                if (isSelectedMode) {
                    stored = stored.filter(item => selectedIds.includes(item.id));
                }

                if (stored.length === 0) {
                    if (typeof mdui !== 'undefined' && mdui.snackbar) {
                        mdui.snackbar({ message: "No downloads available to save.", placement: "top" });
                    }
                    saveAllZipBtn.disabled = false;
                    saveAllZipBtn.textContent = originalText;
                    return;
                }

                const db = await openCacheDB();
                const zipEntries = [];

                for (let i = 0; i < stored.length; i++) {
                    const item = stored[i];
                    saveAllZipBtn.textContent = `Assembling file ${i+1}/${stored.length}...`;

                    try {
                        const tx = db.transaction([STORE_NAME], "readonly");
                        const getRequest = tx.objectStore(STORE_NAME).get(item.id || item.url);

                        const cacheItem = await new Promise((resolve, reject) => {
                            getRequest.onsuccess = (e) => resolve(e.target.result);
                            getRequest.onerror = (e) => reject(e.target.error);
                        });

                        if (cacheItem) {
                            let fileBlob;
                            if (cacheItem.data) {
                                fileBlob = cacheItem.data;
                            } else {
                                const chunks = [];
                                const chunkTx = db.transaction([CHUNK_STORE_NAME], "readonly");
                                const range = IDBKeyRange.bound([item.id || item.url, 0], [item.id || item.url, Infinity]);
                                const cursorRequest = chunkTx.objectStore(CHUNK_STORE_NAME).openCursor(range);

                                await new Promise((resolveChunk, rejectChunk) => {
                                    cursorRequest.onsuccess = (e) => {
                                        const cursor = e.target.result;
                                        if (cursor) {
                                            chunks.push({ index: cursor.value.chunkIndex, data: cursor.value.data });
                                            cursor.continue();
                                        } else {
                                            resolveChunk();
                                        }
                                    };
                                    cursorRequest.onerror = (e) => rejectChunk(e.target.error);
                                });

                                if (chunks.length > 0) {
                                    chunks.sort((a, b) => a.index - b.index);
                                    fileBlob = new Blob(chunks.map(c => c.data), { type: cacheItem.mime || "application/octet-stream" });
                                }
                            }

                            if (fileBlob) {
                                let originalFileName = item.filename || "file";
                                const mimeType = cacheItem.mime || fileBlob.type || "";
                                originalFileName = ensureFileExtension(originalFileName, mimeType);

                                let filename = originalFileName;
                                let counter = 1;
                                while (zipEntries.some(e => e.name === filename)) {
                                    const parts = originalFileName.split('.');
                                    if (parts.length > 1) {
                                        const ext = parts.pop();
                                        filename = `${parts.join('.')}_${counter}.${ext}`;
                                    } else {
                                        filename = `${originalFileName}_${counter}`;
                                    }
                                    counter++;
                                }
                                zipEntries.push({
                                    name: filename,
                                    input: fileBlob
                                });
                            }
                        }
                    } catch (err) {
                        console.error("Error reading file for zip generation:", item.filename, err);
                    }
                }

                if (zipEntries.length === 0) {
                    throw new Error("No files could be read from database. Make sure downloads are completed.");
                }

                saveAllZipBtn.textContent = "Generating ZIP...";
                const zipBlob = globalThis.mediaCompute?.createZip
                    ? await globalThis.mediaCompute.createZip(zipEntries)
                    : await downloadZip(zipEntries).blob();
                const zipName = `downloads_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

                const blobUrl = URL.createObjectURL(zipBlob);
                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = zipName;
                document.body.appendChild(a);
                a.click();

                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                }, 2000);

                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    mdui.snackbar({ message: "ZIP file generated successfully!", placement: "top" });
                }

            } catch (e) {
                console.error("ZIP Generation error:", e);
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    mdui.snackbar({ message: `ZIP Error: ${e.message}`, placement: "top" });
                }
            } finally {
                saveAllZipBtn.disabled = false;
                saveAllZipBtn.textContent = originalText;
            }
        };
    }

    const selectAllCheckbox = document.getElementById('select-all-downloads');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
            const isChecked = selectAllCheckbox.checked;
            const checkboxes = document.querySelectorAll('.card-select-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = isChecked;
            });
            updateSelectedCount();
        });
    }

    const deleteSelectedBtn = document.getElementById('delete-selected-downloads');
    if (deleteSelectedBtn) {
        deleteSelectedBtn.onclick = async () => {
            const checkedBoxes = Array.from(document.querySelectorAll('.card-select-checkbox')).filter(cb => cb.checked);
            if (checkedBoxes.length === 0) return;

            deleteSelectedBtn.disabled = true;

            const selectedIds = checkedBoxes.map(cb => cb.dataset.id);
            const selectedUrlMap = {};
            for (const id of selectedIds) {
                const job = activeJobs.get(id);
                selectedUrlMap[id] = job ? job.url : "";
                const card = document.getElementById(`card-${id}`);
                if (card) card.remove();
                activeJobs.delete(id);
            }

            // Batch-remove selected items from storage in one write to avoid race conditions
            const currentStored = await getStoredDownloads();
            const selectedSet = new Set(selectedIds);
            const remaining = currentStored.filter(item => !selectedSet.has(item.id));
            await saveStoredDownloads(remaining);

            // Now clean cache entries in parallel (skip per-item storage removal since we already did it)
            const deletePromises = selectedIds.map(id =>
                deleteDownloadCacheAndStorage(id, selectedUrlMap[id], { skipStorageRemoval: true })
            );

            const list = document.getElementById('downloads-list');
            const emptyState = document.getElementById('empty-state');
            if (list && list.children.length === 0 && emptyState) {
                emptyState.style.display = 'flex';
            }

            updateSaveAllZipVisibility();
            updateSelectedCount();

            await Promise.all(deletePromises);
            deleteSelectedBtn.disabled = false;
        };
    }

    const closeAllBtn = document.getElementById('close-all-downloads');
    if (closeAllBtn) {
        closeAllBtn.onclick = async () => {
            const confirmClose = confirm("Are you sure you want to close and clear all downloads?");
            if (!confirmClose) return;

            closeAllBtn.disabled = true;
            const stored = await getStoredDownloads();

            // Clear all items from storage in one write first to prevent stale entries on reload
            await saveStoredDownloads([]);

            // Remove cards from DOM and clear activeJobs
            for (const item of stored) {
                const card = document.getElementById(`card-${item.id}`);
                if (card) card.remove();
                activeJobs.delete(item.id);
            }

            const list = document.getElementById('downloads-list');
            const emptyState = document.getElementById('empty-state');
            if (list && emptyState) {
                list.innerHTML = "";
                emptyState.style.display = 'flex';
            }

            updateSaveAllZipVisibility();
            updateSelectedCount();

            // Clean cache entries in parallel (skip per-item storage removal since we already cleared all)
            const deletePromises = stored.map(item =>
                deleteDownloadCacheAndStorage(item.id, item.url, { skipStorageRemoval: true })
            );
            await Promise.all(deletePromises);
            closeAllBtn.disabled = false;
        };
    }

    const heartbeatInterval = setInterval(() => {
        browser.runtime.sendMessage({ action: 'heartbeat' }).catch(() => {});
    }, 15000);

    window.addEventListener('beforeunload', () => {
        clearInterval(heartbeatInterval);
    });
});

async function updateSaveAllZipVisibility() {
    const saveAllZipBtn = document.getElementById('save-all-zip');
    const listHeader = document.getElementById('list-header');
    if (!saveAllZipBtn || !listHeader) return;
    const stored = await getStoredDownloads();
    if (stored.length > 0) {
        listHeader.style.display = 'flex';
        saveAllZipBtn.style.display = 'inline-flex';
    } else {
        listHeader.style.display = 'none';
        saveAllZipBtn.style.display = 'none';
    }
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.card-select-checkbox');
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

    const countSpan = document.getElementById('selected-downloads-count');
    if (countSpan) {
        countSpan.textContent = browser.i18n.getMessage("selectedCount", [checkedCount.toString()]) || `${checkedCount} selected`;
    }

    const deleteBtn = document.getElementById('delete-selected-downloads');
    if (deleteBtn) {
        deleteBtn.style.display = checkedCount > 0 ? 'inline-flex' : 'none';
    }

    const selectAllCheckbox = document.getElementById('select-all-downloads');
    if (selectAllCheckbox) {
        selectAllCheckbox.style.display = 'inline-block';
        if (checkboxes.length === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        } else if (checkedCount === checkboxes.length) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else if (checkedCount > 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }
    }

    const closeAllBtn = document.getElementById('close-all-downloads');
    if (closeAllBtn) {
        closeAllBtn.style.display = checkedCount > 0 ? 'none' : 'inline-flex';
    }

    const saveAllZipBtn = document.getElementById('save-all-zip');
    if (saveAllZipBtn) {
        saveAllZipBtn.textContent = checkedCount > 0
            ? (browser.i18n.getMessage("saveSelectedZip") || "Save Selected as ZIP")
            : (browser.i18n.getMessage("saveAllZip") || "Save All as ZIP");
    }
}
