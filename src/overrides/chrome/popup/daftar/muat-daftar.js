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




function loadMediaList() {
  if (mediaListLoad) {
    mediaListReloadRequested = true;
    return mediaListLoad;
  }
  let loadSukses = false;
  mediaListLoad = (async () => {
    do {
      mediaListReloadRequested = false;
      await loadMediaListOnce();
    } while (mediaListReloadRequested);
    loadSukses = true;
  })().finally(() => {
    mediaListLoad = null;
    if (loadSukses && butuhRefreshSelektifSawiseLoad) {
      butuhRefreshSelektifSawiseLoad = false;
      refreshListMediaSelektif().catch(() => {});
    } else {
      butuhRefreshSelektifSawiseLoad = false;
    }
  });
  return mediaListLoad;
}

async function loadMediaListOnce() {
  const mediaContainer = document.getElementById('media-list');
  const loadingSpinner = document.getElementById('loading-media-list');
  const globalLoading = document.getElementById('loading');
  const mainContent = document.getElementById('main-content');
  const mediaControls = document.getElementById('media-controls');

  const urlParams = new URLSearchParams(window.location.search);
  const autoAudioUrl = urlParams.get('autoDownloadAudioUrl');
  const autoVideoUrl = urlParams.get('autoDownloadVideoUrl');
  const autoOpenUrl = urlParams.get('autoOpenUrl');
  const autoDemuxer = urlParams.get('autoDemuxer') || '';
  const autoCodec = urlParams.get('autoCodec') || '';

  if (autoAudioUrl || autoVideoUrl || autoOpenUrl) {
    const cleanUrl = window.location.pathname + (window.location.search.includes('mode=tab') ? '?mode=tab' : '');
    window.history.replaceState({}, document.title, cleanUrl);
  }

  if (mainContent) mainContent.style.display = 'block';
  if (loadingSpinner) loadingSpinner.style.display = 'block';


  const activeItems = kumpulkanActiveItems();
  mediaContainer.innerHTML = '';
  [...new Set(activeItems.values())].forEach(item => mediaContainer.appendChild(item));

  try {
    const activeDownloadsPromise = getActiveDownloadSnapshot();
    const { mediaRequests, settings, targetWebTab, currentActiveTabId, currentActiveHost } = await ambilDataMediaMentah();
    let activeDownloads = activeDownloadSnapshot || {};
    const quickActiveDownloads = await Promise.race([activeDownloadsPromise, new Promise(resolve => setTimeout(() => resolve(null), 100))]);
    if (quickActiveDownloads) activeDownloads = quickActiveDownloads;
    else activeDownloadsPromise.then(snapshot => restoreActiveDownloadsUI(snapshot)).catch(() => {});
    if (globalLoading) globalLoading.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';


    isGroupingEnabled = settings['group-by-type'] === undefined || settings['group-by-type'] === '1' || settings['group-by-type'] === true;
    isGroupProgressEnabled = settings['group-download-progress'] === undefined || settings['group-download-progress'] === '1' || settings['group-download-progress'] === true;
    updateGlobalProgressVisibility();
    applyManualScanUI(isFlagEnabled(settings['manual-scan'], false), settings['bottom-bar-design'] || 'v3');


    if (isGroupingEnabled) {
      if (autoAudioUrl) {
        const decodedUrl = decodeURIComponent(autoAudioUrl);

        activeGroup = 'audio';
      } else if (autoVideoUrl) {
        activeGroup = 'video';
      } else if (autoOpenUrl) {
        const decodedUrl = decodeURIComponent(autoOpenUrl);

        if (false) {
          activeGroup = 'video';
        } else {
          const type = getMediaType(decodedUrl);
          if (type) {
            activeGroup = type;
          }
        }
      }
    }

    const { items: daftarMediaAnyar, activeCount } = await hitungDaftarMediaBaru(mediaRequests, settings, currentActiveTabId, currentActiveHost, activeItems, activeDownloads);
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    selarasnoSeleksi(allMediaRequests, daftarMediaAnyar);
    allMediaRequests = daftarMediaAnyar;
    allFilteredRequests = [...allMediaRequests];
    generasiModelMedia++;
    downloadingCount = activeCount;
    updateDownloadingCount(0);

    renderInitialList();
    sudahMuatListAwal = true;
    setelanStrukturalPalingAnyar = settings;

    if (autoAudioUrl) {
      const decodedUrl = decodeURIComponent(autoAudioUrl);
      setTimeout(() => {
        const allItems = Array.from(document.querySelectorAll('.media-item'));
        let mediaItemEl = allItems.find(el => {
          const elUrl = el.dataset.url;
          return elUrl === decodedUrl || (elUrl && elUrl.split('?')[0] === decodedUrl.split('?')[0]);
        });
        if (!mediaItemEl) {
          mediaItemEl = allItems.find(el => {
            if (el.hlsFormats) {
              return el.hlsFormats.some(f => {
                if (f.videoUrl === decodedUrl || f.audioUrl === decodedUrl) return true;
                const getItag = (u) => u ? u.match(/[?&]itag=(\d+)/)?.[1] : null;
                const itagFmtVid = getItag(f.videoUrl);
                const itagFmtAud = getItag(f.audioUrl);
                const itagDec = getItag(decodedUrl);
                if (itagDec && (itagDec === itagFmtVid || itagDec === itagFmtAud)) return true;
                return false;
              });
            }
            return false;
          });
        }
        if (mediaItemEl) {
          const audioBtn = mediaItemEl.querySelector('#audio-only-button');
          if (audioBtn && audioBtn.style.display !== 'none') {
            audioBtn.click();
          } else {
            const dlBtn = mediaItemEl.querySelector('#download-button');
            if (dlBtn) dlBtn.click();
          }
        }
      }, 300);
    } else if (autoVideoUrl) {
      const decodedUrl = decodeURIComponent(autoVideoUrl);
      let attempts = 0;
      const tryAutoDownload = () => {
        attempts++;

        // or match by URL
        const allItems = Array.from(document.querySelectorAll('.media-item'));
        let mediaItemEl = allItems.find(el => {
          const elUrl = el.dataset.url;
          return elUrl === decodedUrl || (elUrl && elUrl.split('?')[0] === decodedUrl.split('?')[0]);
        });

        if (!mediaItemEl) {
          mediaItemEl = allItems.find(el => {
            const fmtSel = el.querySelector('.dynamic-format-select');
            const resSel = el.querySelector('.dynamic-resolution-select');
            if (!fmtSel || !resSel) return false;
            // Check if any resolution option's videoUrl matches
            for (const opt of resSel.options) {
              const idx = parseInt(opt.value);
              if (!isNaN(idx)) return true; // Has parsed formats, likely the right item
            }
            return false;
          });
        }
        if (mediaItemEl) {
          const fmtSel = mediaItemEl.querySelector('.dynamic-format-select');
          const codecSel = mediaItemEl.querySelector('.dynamic-codec-select');
          const resSel = mediaItemEl.querySelector('.dynamic-resolution-select');
          const dlBtn = mediaItemEl.querySelector('#download-button');
          if (dlBtn && fmtSel && codecSel && resSel) {
            // Set format (demuxer)
            if (autoDemuxer) {
              for (const opt of fmtSel.options) {
                if (opt.value === autoDemuxer) {
                  fmtSel.value = autoDemuxer;
                  fmtSel.dispatchEvent(new Event('change'));
                  break;
                }
              }
            }
            // Set codec
            if (autoCodec) {
              // Wait a tick for codec dropdown to populate after format change
              setTimeout(() => {
                for (const opt of codecSel.options) {
                  if (opt.value === autoCodec) {
                    codecSel.value = autoCodec;
                    codecSel.dispatchEvent(new Event('change'));
                    break;
                  }
                }
                // Wait for resolution dropdown to populate, then find matching videoUrl
                setTimeout(() => {
                  const hlsFormats = mediaItemEl.hlsFormats;
                  let foundOptValue = null;
                  if (hlsFormats) {
                    for (const opt of resSel.options) {
                      const idx = parseInt(opt.value);
                      if (!isNaN(idx)) {
                        const optionFmt = hlsFormats[idx];
                        if (optionFmt) {
                          const getItag = (u) => u.match(/[?&]itag=(\d+)/)?.[1];
                          const itagOpt = getItag(optionFmt.videoUrl);
                          const itagDec = getItag(decodedUrl);

                          if (optionFmt.videoUrl === decodedUrl || (itagOpt && itagOpt === itagDec)) {
                            foundOptValue = opt.value;
                            break;
                          }
                        }
                      }
                    }
                  }

                  if (foundOptValue !== null) {
                    resSel.value = foundOptValue;
                    resSel.dispatchEvent(new Event('change'));
                  }

                  mediaItemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  setTimeout(() => dlBtn.click(), 200);
                }, 50);
              }, 50);
            } else {
              mediaItemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => dlBtn.click(), 200);
            }
            return;
          }
        }
        if (attempts < 20) {
          setTimeout(tryAutoDownload, 300);
        }
      };
      setTimeout(tryAutoDownload, 500);
    }
    } catch (err) {
    console.error("Error loading media list:", err);
    if (globalLoading) globalLoading.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    if (mediaContainer) {
      const errorEl = document.createElement('div');
      errorEl.id = 'media-list-error';
      errorEl.style.cssText = 'padding: 60px 20px; text-align: center;';
      const errorText = document.createElement('div');
      errorText.style.cssText = 'opacity: 0.8; margin-bottom: 16px;';
      errorText.textContent = 'Gagal muat daftar media. Service worker mungkin lagi turu utawa sibuk.';
      const retryBtn = document.createElement('mdui-button');
      retryBtn.setAttribute('variant', 'filled');
      retryBtn.textContent = 'Coba maneh';
      retryBtn.addEventListener('click', () => loadMediaList().catch(() => {}));
      errorEl.appendChild(errorText);
      errorEl.appendChild(retryBtn);
      mediaContainer.appendChild(errorEl);
    }
  }
}
