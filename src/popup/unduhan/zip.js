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



function isYoutubeVideoItem(item) {
  const request = item instanceof HTMLElement
    ? allFilteredRequests.find(entry => entry.bestRequest.originalUrl === item.dataset.url || entry.bestRequest.url === item.dataset.url)
    : item;
  const bestRequest = request?.bestRequest || {};
  const isVideo = request?.isVideo || request?.type === 'video';
  const source = `${bestRequest.originalUrl || bestRequest.url || ''} ${bestRequest.pageUrl || ''}`;

  return Boolean(isVideo && (
    request?.ytFormats?.length ||
    bestRequest.ytFormats?.length ||
    /(?:^|[./])(?:youtube\.com|youtu\.be|googlevideo\.com)(?:[/:]|$)/i.test(source)
  ));
}

async function downloadAllAsZip(items) {
  items = items.filter(item => !isYoutubeVideoItem(item));
  if (items.length === 0) return;

  let recoveryJobId = null;
  const backgroundSetting = await browser.storage.local.get('background-download');
  const backgroundDownloadEnabled = backgroundSetting['background-download'] !== '0';

  const downloadItems = [];
  const progressContainer = document.getElementById('global-progress-container');
  const progressBar = document.getElementById('global-progress-bar');
  const progressText = document.getElementById('global-progress-text');

  try {
    await ensureScriptLoaded('libraries/client-zip.js', 'downloadZip');
    if (!(isGroupingEnabled && isGroupProgressEnabled && activeGroup === null)) {
      progressContainer.style.display = 'flex';
    } else {
      progressContainer.style.display = 'none';
    }
    progressBar.value = 0;
    progressText.textContent = browser.i18n.getMessage("zipPreparing", [items.length]);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let url, targetRequest;

      if (item instanceof HTMLElement) {
        url = item.dataset.url;
        const requestData = allFilteredRequests.find(r => r.bestRequest.originalUrl === url || r.bestRequest.url === url);
        targetRequest = requestData ? requestData.bestRequest : null;
      } else {

        url = item.bestRequest.originalUrl;
        targetRequest = item.bestRequest;
      }

      const originalFileName = getFileName(url, 100);
      let filename = originalFileName;
      let counter = 1;
      while (downloadItems.some(e => e.filename === filename)) {
        const parts = originalFileName.split('.');
        if (parts.length > 1) {
          const ext = parts.pop();
          filename = `${parts.join('.')}_${counter}.${ext}`;
        } else {
          filename = `${originalFileName}_${counter}`;
        }
        counter++;
      }

      downloadItems.push({
        url, filename, request: targetRequest,
        groupType: item instanceof HTMLElement ? (item.dataset.type || null) : (item?.type || null)
      });
    }

    const zipGroupTypes = [...new Set(downloadItems.map(item => item.groupType).filter(Boolean))];
    const zipGroupType = activeGroup || (zipGroupTypes.length === 1 ? zipGroupTypes[0] : 'file');

    // With background downloads disabled, keep the work owned by this UI so
    // closing the extension view also stops the download.
    if (!backgroundDownloadEnabled || !browser.tabs?.create) {
      recoveryJobId = await rememberPopupDownload('zip', 'zip://local', null, null, 'downloads.zip', { items });

      try {
        let skipAllErrors = false;
        progressBar.max = downloadItems.length;

        let isLocalZipPaused = false;
        const waitIfLocalZipPaused = async () => {
          while (isLocalZipPaused) {
            if (window.activeCancellations && window.activeCancellations.has('global_zip')) {
              throw new Error("Cancelled");
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        };

        const zipEntriesGenerator = async function* () {
          for (let i = 0; i < downloadItems.length; i++) {
            await waitIfLocalZipPaused();
            const item = downloadItems[i];

            if (window.activeCancellations && window.activeCancellations.has('global_zip')) {
              throw new Error("Cancelled");
            }

            const currentZipText = `${isLocalZipPaused ? `[${(browser?.i18n?.getMessage?.("pausedStatus") || chrome?.i18n?.getMessage?.("pausedStatus")) || "Paused"}] ` : ""}${browser.i18n.getMessage("zipDownloading", [i + 1, downloadItems.length, item.filename])}`;
            progressText.textContent = currentZipText;
            progressBar.value = i;

            const localZipPct = (i / downloadItems.length) * 100;
            const updateLocalZipUI = () => {
              const txt = `${isLocalZipPaused ? `[${(browser?.i18n?.getMessage?.("pausedStatus") || chrome?.i18n?.getMessage?.("pausedStatus")) || "Paused"}] ` : ""}${browser.i18n.getMessage("zipDownloading", [String(i + 1), String(downloadItems.length), item.filename])}`;
              progressText.textContent = txt;
              syncZipProgressToGroupCards(
                `📦 ZIP • ${txt}`,
                localZipPct, false,
                () => { if (window.activeCancellations) window.activeCancellations.add('global_zip'); clearZipProgressFromGroupCards(recoveryJobId); },
                isLocalZipPaused,
                () => { isLocalZipPaused = !isLocalZipPaused; updateLocalZipUI(); },
                zipGroupType, recoveryJobId
              );
            };
            updateLocalZipUI();

            try {
              const response = await spoofedFetch(item.url, item.request);
              if (!response.ok) {
                if (await shouldSkipHttpError(response.status)) continue;
                throw new Error(`Server returned ${response.status}`);
              }

              const blob = await response.blob();
              yield { name: item.filename, input: blob };
            } catch (err) {
              console.warn(`Local ZIP fetch error for ${item.url}:`, err);
              if (skipAllErrors) continue;

              const result = await showConfirmDialog(
                browser.i18n.getMessage("zipDownloadError", [item.filename, err.message]),
                browser.i18n.getMessage("downloadErrorTitle") || "Download Error"
              );

              if (result === 'continue-all') {
                skipAllErrors = true;
                continue;
              }
              if (result !== 'continue') {
                throw new Error("Cancelled by user after error");
              }
            }
          }
        };

        progressText.textContent = browser.i18n.getMessage("zipGenerating") || "Generating ZIP archive...";
        progressBar.indeterminate = true;
        syncZipProgressToGroupCards(`📦 ZIP • ${browser.i18n.getMessage("zipGenerating") || "Generating ZIP archive..."}`, 95, false, null, false, null, zipGroupType, recoveryJobId);

        const zipBlob = await downloadZip(zipEntriesGenerator()).blob();
        const zipName = `downloads_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

        if (typeof finalizeDownload === 'function') {
            const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method'] || 'browser');
            await finalizeDownload(zipBlob, zipName, downloadMethod, progressBar, false, false);
            progressContainer.style.display = 'none'; clearZipProgressFromGroupCards(recoveryJobId);
        } else {
            const blobUrl = URL.createObjectURL(zipBlob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = zipName;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
              progressContainer.style.display = 'none';
              clearZipProgressFromGroupCards(recoveryJobId);
            }, 2000);
        }

        if (typeof mdui !== 'undefined' && mdui.snackbar) {
          tampilnoNotif(browser.i18n.getMessage("zipComplete") || "ZIP download complete!");
        }
        syncZipProgressToGroupCards(`📦 ZIP • ${browser.i18n.getMessage("zipComplete") || "ZIP download complete!"}`, 100, false, null, false, null, zipGroupType, recoveryJobId);

      } catch (e) {
        if (e.message !== "Cancelled") {
          if (replayingPopupJob) keepPopupRecovery = true;
          console.error("Local ZIP error:", e);
          showDialog(browser.i18n.getMessage("zipError", [e.message]));
          syncZipProgressToGroupCards(`📦 ZIP Error: ${e.message}`, 0, false, null, false, null, zipGroupType, recoveryJobId);
          setTimeout(() => clearZipProgressFromGroupCards(recoveryJobId), 5000);
        }
        progressContainer.style.display = 'none';
        clearZipProgressFromGroupCards(recoveryJobId);
      }
    } else {

      await browser.runtime.sendMessage({
        action: 'startPersistentZipJob',
        items: downloadItems,
        groupType: zipGroupType
      });

      if (typeof mdui !== 'undefined' && mdui.snackbar) {
        tampilnoNotif(browser.i18n.getMessage("zipStartedInBackground") || "ZIP download started in background");
      }
    }

  } catch (error) {
    console.error('ZIP background start error:', error);
    progressText.textContent = browser.i18n.getMessage("zipError", [error.message]);
    progressBar.value = 0;
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 5000);
  } finally {
    await forgetPopupDownload(recoveryJobId);
  }
}
