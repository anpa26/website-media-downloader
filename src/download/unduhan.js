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


const activeJobs = new Map();

async function triggerDownload(id, url, filename) {
    const statusText = document.getElementById(`status-text-${id}`);
    const progressContainer = document.getElementById(`progress-container-${id}`);
    const progress = document.getElementById(`progress-${id}`);
    const saveButton = document.getElementById(`save-${id}`);
    const pauseBtn = document.getElementById(`pause-${id}`);
    const resumeBtn = document.getElementById(`resume-${id}`);
    const cancelBtn = document.getElementById(`cancel-${id}`);

    const setStatus = (text) => { if (statusText) statusText.textContent = text; };

    try {
        setStatus(browser.i18n.getMessage("downloadConnectingDB") || "Connecting to Database...");
        const db = await openCacheDB();

        setStatus(browser.i18n.getMessage("downloadFetchingMetadata") || "Fetching Metadata...");
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const cacheKey = id || url;
        const getRequest = store.get(cacheKey);

        getRequest.onsuccess = async (event) => {
            try {
                const item = event.target.result;
                if (item) {
                    let blob;
                    if (item.data) {
                        blob = item.data;
                    } else {
                        setStatus(browser.i18n.getMessage("downloadReconstructing") || "Reconstructing file from segments...");
                        const chunks = [];
                        const chunkTx = db.transaction([CHUNK_STORE_NAME], "readonly");
                        const chunkStore = chunkTx.objectStore(CHUNK_STORE_NAME);

                        const range = IDBKeyRange.bound([cacheKey, 0], [cacheKey, Infinity]);
                        const cursorRequest = chunkStore.openCursor(range);

                        let lastUpdate = Date.now();
                        await new Promise((resolveChunk, rejectChunk) => {
                            cursorRequest.onsuccess = (e) => {
                                const cursor = e.target.result;
                                if (cursor) {
                                    chunks.push({
                                        index: cursor.value.chunkIndex,
                                        data: cursor.value.data
                                    });

                                    const now = Date.now();
                                    if (now - lastUpdate > 500) {
                                        setStatus((browser.i18n.getMessage("downloadReconstructingSegment") || "Reconstructing segment $1...").replace("$1", chunks.length));
                                        lastUpdate = now;
                                    }
                                    cursor.continue();
                                } else {
                                    resolveChunk();
                                }
                            };
                            cursorRequest.onerror = (e) => rejectChunk(e.target.error);
                        });

                        if (chunks.length === 0) {
                            throw new Error(browser.i18n.getMessage("downloadMetadataNotFound") || "Metadata not found in Database.");
                        }

                        chunks.sort((a, b) => a.index - b.index);
                        setStatus((browser.i18n.getMessage("downloadAssemblingParts") || "Assembling $1 parts...").replace("$1", chunks.length));
                        const blobData = chunks.map(c => c.data);
                        blob = new Blob(blobData, { type: item.mime || "application/octet-stream" });
                    }

                    const mimeType = item.mime || blob.type || "";
                    const originalFilename = filename;
                    filename = ensureFileExtension(filename, mimeType);

                    if (filename !== originalFilename) {
                        const card = document.getElementById(`card-${id}`);
                        if (card) {
                            const nameEl = card.querySelector('.file-name');
                            if (nameEl) {
                                nameEl.textContent = filename;
                            }
                        }
                        activeJobs.set(id, { url, filename });
                        try {
                            const stored = await getStoredDownloads();
                            let updated = false;
                            for (const storedItem of stored) {
                                if (storedItem.id === id) {
                                    storedItem.filename = filename;
                                    updated = true;
                                }
                            }
                            if (updated) {
                                await saveStoredDownloads(stored);
                            }
                        } catch (e) {
                            console.warn("Failed to update stored download filename extension:", e);
                        }
                    }

                    const objectUrl = URL.createObjectURL(blob);
                    const settings = await browser.storage.local.get(['save-to-gdrive', 'save-to-dropbox']);

                    if (settings['save-to-dropbox'] === '1') {
                        const controller = new CloudUploadController();
                        if (pauseBtn) {
                            pauseBtn.style.display = 'inline-block';
                            cancelBtn.style.display = 'inline-block';

                            pauseBtn.onclick = () => {
                                controller.pause();
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'inline-block';
                                setStatus(browser.i18n.getMessage("uploadPausedTitle") || "Upload Paused");
                            };

                            resumeBtn.onclick = () => {
                                controller.resume();
                                resumeBtn.style.display = 'none';
                                pauseBtn.style.display = 'inline-block';
                                setStatus(browser.i18n.getMessage("uploadingToDropbox", [filename]) || `Uploading ${filename} to Dropbox...`);
                            };

                            cancelBtn.onclick = () => {
                                controller.cancel();
                            };
                        }

                        try {
                            setStatus((browser.i18n.getMessage("uploadingToDropbox", [filename]) || `Uploading ${filename} to Dropbox...`) + " (0%)");
                            if (progressContainer) progressContainer.style.display = 'block';
                            if (progress) progress.style.width = '0%';

                            await uploadToDropbox(blob, filename, (percent) => {
                                setStatus((browser.i18n.getMessage("uploadingToDropbox", [filename]) || `Uploading ${filename} to Dropbox...`) + ` (${percent}%)`);
                                if (progress) progress.style.width = percent + '%';
                            }, controller);

                            if (pauseBtn) {
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'none';
                                cancelBtn.style.display = 'none';
                            }
                            if (progressContainer) progressContainer.style.display = 'none';
                            setStatus(browser.i18n.getMessage("uploadSuccessDropbox", [filename]) || `Successfully saved ${filename} to Dropbox!`);
                            browser.runtime.sendMessage({ action: 'downloadComplete', id: cacheKey, url: url, cloud: true }).catch(() => {});
                            await removeStoredDownload(id);
                            return;
                        } catch (error) {
                            if (pauseBtn) {
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'none';
                                cancelBtn.style.display = 'none';
                            }
                            if (progressContainer) progressContainer.style.display = 'none';
                            if (error.message === "Upload cancelled") {
                                setStatus(browser.i18n.getMessage("uploadCancelledTitle") || "Upload Cancelled");
                            } else {
                                setStatus((browser.i18n.getMessage("uploadFailedDropbox") || "Dropbox Upload Failed") + `: ${error.message}`);
                            }
                            return;
                        }
                    } else if (settings['save-to-gdrive'] === '1') {
                        const controller = new CloudUploadController();
                        if (pauseBtn) {
                            pauseBtn.style.display = 'inline-block';
                            cancelBtn.style.display = 'inline-block';

                            pauseBtn.onclick = () => {
                                controller.pause();
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'inline-block';
                                setStatus(browser.i18n.getMessage("uploadPausedTitle") || "Upload Paused");
                            };

                            resumeBtn.onclick = () => {
                                controller.resume();
                                resumeBtn.style.display = 'none';
                                pauseBtn.style.display = 'inline-block';
                                setStatus(browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...");
                            };

                            cancelBtn.onclick = () => {
                                controller.cancel();
                            };
                        }

                        try {
                            setStatus(browser.i18n.getMessage("uploadingToGDrive", [filename]) || `Uploading ${filename} to Google Drive...`);
                            if (progressContainer) progressContainer.style.display = 'block';
                            if (progress) progress.style.width = '0%';

                            await uploadToGDrive(blob, filename, (percent) => {
                                setStatus((browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${percent}%)`);
                                if (progress) progress.style.width = percent + '%';
                            }, controller);

                            if (pauseBtn) {
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'none';
                                cancelBtn.style.display = 'none';
                            }
                            if (progressContainer) progressContainer.style.display = 'none';
                            setStatus(browser.i18n.getMessage("uploadSuccessGDrive", [filename]) || `Successfully saved ${filename} to Google Drive!`);
                            browser.runtime.sendMessage({ action: 'downloadComplete', id: cacheKey, url: url, cloud: true }).catch(() => {});
                            await removeStoredDownload(id);
                            return;
                        } catch (error) {
                            if (pauseBtn) {
                                pauseBtn.style.display = 'none';
                                resumeBtn.style.display = 'none';
                                cancelBtn.style.display = 'none';
                            }
                            if (progressContainer) progressContainer.style.display = 'none';
                            if (error.message === "Upload cancelled") {
                                setStatus(browser.i18n.getMessage("uploadCancelledTitle") || "Upload Cancelled");
                            } else {
                                setStatus((browser.i18n.getMessage("uploadFailedGDrive") || "Cloud upload failed") + `: ${error.message}`);
                            }
                            return;
                        }
                    }

                    setStatus(browser.i18n.getMessage("downloadReadyText") || "Ready to Save");

                    const previewBtn = document.getElementById(`preview-${id}`);
                    const previewContainer = document.getElementById(`preview-container-${id}`);

                    const isVideo = mimeType.startsWith("video/") || /\.(mp4|webm|ogg|mkv|mov|avi|flv)$/i.test(filename);
                    const isAudio = mimeType.startsWith("audio/") || /\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(filename);

                    if (previewBtn && previewContainer && (isVideo || isAudio)) {
                        previewBtn.style.display = "inline-block";
                        previewBtn.onclick = () => {
                            if (previewContainer.style.display === "none") {
                                previewContainer.innerHTML = "";
                                if (isVideo) {
                                    const video = document.createElement("video");
                                    video.src = objectUrl;
                                    video.controls = true;
                                    video.style.width = "100%";
                                    video.style.maxHeight = "360px";
                                    video.autoplay = true;
                                    previewContainer.appendChild(video);
                                } else if (isAudio) {
                                    const audio = document.createElement("audio");
                                    audio.src = objectUrl;
                                    audio.controls = true;
                                    audio.style.width = "100%";
                                    audio.style.padding = "10px";
                                    audio.autoplay = true;
                                    previewContainer.appendChild(audio);
                                }
                                previewContainer.style.display = "block";
                                previewBtn.textContent = browser.i18n.getMessage("closePreview") || "Close Preview";
                            } else {
                                previewContainer.innerHTML = "";
                                previewContainer.style.display = "none";
                                previewBtn.textContent = browser.i18n.getMessage("previewMedia") || "Preview";
                            }
                        };
                    }

                    if (saveButton) {
                        saveButton.style.display = "inline-block";

                        const performDownload = async () => {
                            const a = document.createElement("a");
                            a.href = objectUrl;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);

                            setStatus(browser.i18n.getMessage("downloadStartedText") || "Download Started");
                            saveButton.disabled = true;
                            saveButton.style.opacity = "0.5";
                            browser.runtime.sendMessage({ action: 'downloadComplete', id: cacheKey, url: url }).catch(() => {});
                            await removeStoredDownload(id);
                        };

                        saveButton.onclick = performDownload;
                    }
                } else {
                    setStatus(browser.i18n.getMessage("downloadMetadataNotFound") || "Metadata not found in Database.");
                }
            } catch (innerError) {
                setStatus((browser.i18n.getMessage("downloadProcessingError") || "Processing Error") + `: ${innerError.message}`);
            }
        };

        getRequest.onerror = () => {
            setStatus(browser.i18n.getMessage("downloadDatabaseErrorText") || "Database retrieval failed.");
        };

    } catch (error) {
        setStatus((browser.i18n.getMessage("downloadUnexpectedError") || "Unexpected Error") + `: ${error.message}`);
    }
}

async function addNewDownload(id, url, filename) {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';

    const list = document.getElementById('downloads-list');

    if (document.getElementById(`card-${id}`)) return;

    const stored = await getStoredDownloads();
    if (!stored.some(item => item.id === id)) {
        stored.push({ id, url, filename });
        await saveStoredDownloads(stored);
    }

    const card = document.createElement('div');
    card.className = 'download-card';
    card.id = `card-${id}`;
    card.dataset.id = id;
    card.innerHTML = `
      <div class="card-content">
        <div class="card-header" style="align-items: center;">
          <mdui-checkbox class="card-select-checkbox" data-id="${id}" style="margin-right: -4px;"></mdui-checkbox>
          <div class="icon-wrapper">
            <mdui-icon>
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            </mdui-icon>
          </div>
          <div class="info-wrapper">
            <h4 class="file-name">${escapeHtmlDownload(filename || browser.i18n.getMessage("defaultMediaName"))}</h4>
            <p class="status-text" id="status-text-${id}">${browser.i18n.getMessage("downloadWaiting") || "Preparing..."}</p>
          </div>
        </div>
        <div class="progress-bar-wrapper">
          <mdui-linear-progress id="progress-${id}" value="0" style="display: none;"></mdui-linear-progress>
        </div>
        <div id="preview-container-${id}" style="display: none; margin-top: 10px; width: 100%; border-radius: 8px; overflow: hidden; background: #000; line-height: 0;"></div>
        <div class="button-group">
          <mdui-button id="preview-${id}" variant="tonal" style="display: none; color: rgb(var(--mdui-color-primary));">${browser.i18n.getMessage("previewMedia") || "Preview"}</mdui-button>
          <div style="flex-grow: 1;"></div>
          <mdui-button id="save-${id}" variant="filled" style="display: none;">${browser.i18n.getMessage("saveFileLabel") || "Save"}</mdui-button>
          <mdui-button id="pause-${id}" variant="tonal" style="display: none;">${browser.i18n.getMessage("uploadPausedTitle") || "Pause"}</mdui-button>
          <mdui-button id="resume-${id}" variant="filled" style="display: none;">${browser.i18n.getMessage("uploadResumedTitle") || "Resume"}</mdui-button>
          <mdui-button id="cancel-${id}" variant="outlined" style="display: none;">${browser.i18n.getMessage("uploadCancelledTitle") || "Cancel"}</mdui-button>
          <mdui-button id="close-${id}" variant="text">${browser.i18n.getMessage("closePreview") || "Close"}</mdui-button>
        </div>
      </div>
    `;
    list.appendChild(card);

    const closeBtn = document.getElementById(`close-${id}`);
    if (closeBtn) {
        closeBtn.onclick = async () => {
            card.remove();
            activeJobs.delete(id);
            await deleteDownloadCacheAndStorage(id, url);

            if (list.children.length === 0 && emptyState) {
                emptyState.style.display = 'flex';
            }
            updateSaveAllZipVisibility();
            updateSelectedCount();
        };
    }

    const cardCheckbox = card.querySelector('.card-select-checkbox');
    if (cardCheckbox) {
        cardCheckbox.addEventListener('change', () => {
            updateSelectedCount();
        });
    }

    const cacheKey = id || url;
    browser.runtime.sendMessage({ action: 'registerDownloadTab', id: cacheKey }).catch(() => {});

    activeJobs.set(id, { url, filename });
    triggerDownload(id, url, filename);

    updateSaveAllZipVisibility();
}

// Receive new downloads from background service worker
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'startDownload') return false;
    addNewDownload(message.id, message.url, message.filename)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
});
