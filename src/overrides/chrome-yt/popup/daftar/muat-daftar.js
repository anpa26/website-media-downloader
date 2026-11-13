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
  const autoQualityParam = urlParams.get('autoQuality') || '';

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
        const isYouTube = decodedUrl.includes('googlevideo.com') || decodedUrl.includes('youtube.com') || decodedUrl.includes('youtu.be');
        activeGroup = isYouTube ? 'video' : 'audio';
      } else if (autoVideoUrl) {
        activeGroup = 'video';
      } else if (autoOpenUrl) {
        const decodedUrl = decodeURIComponent(autoOpenUrl);
        const isYouTube = decodedUrl.includes('googlevideo.com') || decodedUrl.includes('youtube.com') || decodedUrl.includes('youtu.be');
        if (isYouTube) {
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
      let attempts = 0;
      const tryAutoAudioDownload = () => {
        attempts++;
        const allItems = Array.from(document.querySelectorAll('.media-item'));
        let mediaItemEl = allItems.find(el => {
          const elUrl = el.dataset.url;
          if (elUrl === decodedUrl || (elUrl && elUrl.split('?')[0] === decodedUrl.split('?')[0])) return true;
          return Array.isArray(el.ytFormats) && el.ytFormats.some(format => {
            if (format.videoUrl === decodedUrl || format.audioUrl === decodedUrl) return true;
            const getItag = url => url ? url.match(/[?&]itag=(\d+)/)?.[1] : null;
            const targetItag = getItag(decodedUrl);
            return targetItag && (targetItag === getItag(format.videoUrl) || targetItag === getItag(format.audioUrl));
          });
        });
        const audioBtn = mediaItemEl?.querySelector('#audio-only-button');
        if (audioBtn && audioBtn.style.display !== 'none') {
          audioBtn.click();
          return;
        }
        if (attempts < 20) setTimeout(tryAutoAudioDownload, 300);
      };
      setTimeout(tryAutoAudioDownload, 300);
    } else if (autoVideoUrl) {
      const decodedUrl = decodeURIComponent(autoVideoUrl);
      let attempts = 0;
      const tryAutoDownload = () => {
        attempts++;
        // Find any media item that has yt-format/yt-codec/yt-resolution selectors (YouTube item)
        // or match by URL
        const allItems = Array.from(document.querySelectorAll('.media-item'));
        let mediaItemEl = allItems.find(el => {
          const elUrl = el.dataset.url;
          return elUrl === decodedUrl || (elUrl && elUrl.split('?')[0] === decodedUrl.split('?')[0]);
        });
        // If no direct match, try finding by YouTube format selectors — the dataset.url may be for a different resolution
        if (!mediaItemEl) {
          mediaItemEl = allItems.find(el => {
            const fmtSel = el.querySelector('.yt-format-select');
            const resSel = el.querySelector('.yt-resolution-select');
            if (!fmtSel || !resSel) return false;
            // Check if any resolution option's videoUrl matches
            for (const opt of resSel.options) {
              const idx = parseInt(opt.value);
              if (!isNaN(idx)) return true; // Has YT formats, likely the right item
            }
            return false;
          });
        }
        if (mediaItemEl) {
          const fmtSel = mediaItemEl.querySelector('.yt-format-select');
          const codecSel = mediaItemEl.querySelector('.yt-codec-select');
          const resSel = mediaItemEl.querySelector('.yt-resolution-select');
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
            // Apply quality preference to resSel first before clicking download
            const applyQualityAndDownload = async () => {
              try {
                let qualityPref = autoQualityParam;
                if (!qualityPref) {
                  const st = await browser.storage.local.get(['auto-download-quality', 'stream-quality']);
                  qualityPref = st['auto-download-quality'] || st['stream-quality'] || 'highest';
                }
                if (resSel && resSel.options.length > 0) {
                  if (qualityPref === 'lowest') {
                    resSel.value = resSel.options[resSel.options.length - 1].value;
                  } else if (qualityPref === 'highest') {
                    resSel.value = resSel.options[0].value;
                  }
                  resSel.dispatchEvent(new Event('change'));
                }
              } catch (e) {}
              mediaItemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => dlBtn.click(), 250);
            };

            // Set codec
            if (autoCodec) {
              setTimeout(() => {
                for (const opt of codecSel.options) {
                  if (opt.value === autoCodec) {
                    codecSel.value = autoCodec;
                    codecSel.dispatchEvent(new Event('change'));
                    break;
                  }
                }
                setTimeout(applyQualityAndDownload, 100);
              }, 50);
            } else {
              applyQualityAndDownload();
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
