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



async function finalizeDownload(blob, filename, downloadMethod, loadingBar = null, streamedToGDrive = false, streamedToDropbox = false) {
    if (blob) {
        filename = ensureFileExtension(filename, blob.type);
    }
    if (!blob) {
        if (streamedToGDrive) {
            if (loadingBar) {
                loadingBar.value = 100;
                loadingBar.removeAttribute('indeterminate');
                const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                if (statusInfo) {
                    statusInfo.textContent = browser.i18n.getMessage("uploadSuccessGDriveTitle") || `Upload Complete!`;
                }
            }
        }
        return;
    }

    const settings = await browser.storage.local.get(['save-to-gdrive', 'gdrive_token', 'save-to-dropbox', 'dropbox_token']);
    const gdriveEnabled = settings['save-to-gdrive'] === '1' && settings['gdrive_token'];
    const dropboxEnabled = settings['save-to-dropbox'] === '1' && settings['dropbox_token'];
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid && !gdriveEnabled && !dropboxEnabled && typeof storeCompletedDownloadBlob === 'function' && typeof browser !== 'undefined' && browser.runtime) {
        try {
            const cacheId = 'processed_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            await storeCompletedDownloadBlob(cacheId, blob, blob.type);
            const tersimpan = await browser.runtime.sendMessage({ action: 'download_cached_blob', cacheId, filename, mime: blob.type, size: blob.size });
            if (tersimpan?.success) {
                if (loadingBar) {
                    loadingBar.value = 100;
                    loadingBar.removeAttribute('indeterminate');
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("downloadComplete") || "Download Complete!";
                }
                return;
            }
        } catch (e) {
            console.warn("Simpan via cache Android gagal, lanjut jalur biasa:", e);
        }
    }

    // Trigger local download first or early to preserve user gesture
    const objectUrl = URL.createObjectURL(blob);
    const triggerLocalDownload = async () => {
        return new Promise((resolve) => {
            const fallbackDownload = () => {
                const a = document.createElement("a");
                a.href = objectUrl;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    if (a.parentNode) document.body.removeChild(a);
                    resolve(true);
                }, 1000);
            };

            if (downloadMethod === "browser" && typeof browser !== 'undefined' && browser.downloads) {
                try {
                    browser.downloads.download({ url: objectUrl, filename: filename }, (downloadId) => {
                        if (browser.runtime.lastError) {
                            console.warn("browser.downloads.download failed:", browser.runtime.lastError.message);
                            fallbackDownload();
                        } else {
                            resolve(true);
                        }
                    });
                } catch (e) {
                    console.warn("browser.downloads.download sync failed, falling back to <a> click:", e);
                    fallbackDownload();
                }
            } else {
                fallbackDownload();
            }
        });
    };


    if (dropboxEnabled && !streamedToDropbox) {
        const controller = new CloudUploadController();
        try {
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(`Uploading ${filename} to Dropbox...`, { aksi: { label: "Cancel", lakokno: () => controller.cancel() } });
            }

            if (loadingBar) {
                loadingBar.max = 100;
                loadingBar.removeAttribute('indeterminate');
            }

            await uploadToDropbox(blob, filename, (percent) => {
                if (loadingBar) {
                    loadingBar.value = percent;
                    loadingBar.classList.add('uploading-phase');
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) {
                        statusInfo.textContent = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${percent}%)`;
                    }
                }
            }, controller);

            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(`Successfully uploaded ${filename} to Dropbox`);
            }
            if (loadingBar) {
                const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                if (statusInfo) {
                    statusInfo.textContent = browser.i18n.getMessage("uploadSuccessGDriveTitle") || `Upload Complete!`;
                }
            }
        } catch (e) {
            console.error("Dropbox fallback upload failed:", e);
            if (e.message !== "Upload cancelled" && typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(`Dropbox Upload Failed: ${e.message}`);
            }
            triggerLocalDownload();
        }
        return;
    }

    if (gdriveEnabled && !streamedToGDrive) {
        const controller = new CloudUploadController();
        try {
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(browser.i18n.getMessage("uploadingToGDrive", [filename]) || `Uploading ${filename} to Google Drive...`, { aksi: { label: "Cancel", lakokno: () => controller.cancel() } });
            }

            if (loadingBar) {
                loadingBar.max = 100;
                loadingBar.removeAttribute('indeterminate');
            }

            await uploadToGDrive(blob, filename, (percent) => {
                if (loadingBar) {
                    loadingBar.value = percent;
                    loadingBar.classList.add('uploading-phase');
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) {
                        statusInfo.textContent = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${percent}%)`;
                    }
                }
            }, controller);

            if (loadingBar) {
                loadingBar.value = 100;
                const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                if (statusInfo) {
                    statusInfo.textContent = browser.i18n.getMessage("uploadSuccessGDrive", [filename]) || `Successfully saved to Google Drive!`;
                }
            }

            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(browser.i18n.getMessage("uploadSuccessGDrive", [filename]) || `Successfully saved ${filename} to Google Drive!`);
            }
        } catch (error) {
            if (error.message === "Upload cancelled") {
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    tampilnoNotif(browser.i18n.getMessage("uploadCancelledTitle") || "Upload Cancelled");
                }
            } else {
                console.error("GDrive upload failed, falling back to local download:", error);
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    tampilnoNotif((browser.i18n.getMessage("uploadFailedGDrive") || "Cloud upload failed") + `: ${error.message}. Downloading locally instead.`);
                }
                await triggerLocalDownload();
                if (loadingBar) {
                    loadingBar.value = 100;
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) {
                        statusInfo.textContent = browser.i18n.getMessage("downloadComplete") || "Download Complete!";
                    }
                }
            }
        }
        return;
    }

    if (!streamedToGDrive && !streamedToDropbox) {
        await triggerLocalDownload();
        if (loadingBar) {
            loadingBar.value = 100;
            const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
            if (statusInfo) {
                statusInfo.textContent = browser.i18n.getMessage("downloadComplete") || "Download Complete!";
            }
        }
    }

    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
}
