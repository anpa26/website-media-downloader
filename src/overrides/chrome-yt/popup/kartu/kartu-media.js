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




function createMediaItem(item) {
  const { bestRequest, isVideo, isAudio, isStream, isSubtitle, isFile, isImage } = item;
  const ytFormats = item.ytFormats || null;
  let mediaURL;
  try {
    mediaURL = new URL(bestRequest.originalUrl);
  } catch (_) {
    throw new Error('URL media ora valid: ' + String(bestRequest?.originalUrl || ''));
  }

  const mediaDiv = document.createElement('div');
  mediaDiv.classList.add('media-item');
  mediaDiv.dataset.originalUrl = bestRequest.originalUrl;
  mediaDiv.dataset.url = bestRequest.originalUrl;
  mediaDiv.dataset.size = bestRequest.size;
  mediaDiv.dataset.type = isVideo ? 'video' : isAudio ? 'audio' : isStream ? 'stream' : isImage ? 'image' : isSubtitle ? 'subtitle' : 'file';
  if (ytFormats) {
    mediaDiv.ytFormats = ytFormats;
  }
  if (item.ytSubtitles) {
    mediaDiv.ytSubtitles = item.ytSubtitles;
  }

  let activeUrl = bestRequest.originalUrl;
  let activeAudioUrl = null;
  let activeSize = bestRequest.size;

  let hls = null;
  let hlsLarge = null;
  let isSyncing = false;
  let resolvedM3u8Url = null;
  let inlinePreview = null;
  let largeVideo = null;

  const getPlayableUrl = async (url) => {
    if (!url) return url;
    if (url.toLowerCase().includes('.mpd')) {
      if (resolvedM3u8Url) return resolvedM3u8Url;
      try {
        await ensureScriptLoaded('popup/kartu/mpd.js', 'getM3u8BlobUrlFromMpd');
        resolvedM3u8Url = await getM3u8BlobUrlFromMpd(url, bestRequest.responseHeaders);
        return resolvedM3u8Url;
      } catch (e) {
        console.error("MPD to M3U8 conversion failed:", e);
        return url;
      }
    }
    return url;
  };

  const ensureHlsLoaded = async (targetVideo, isLargeTarget) => {
    if (!isStream) return;
    await ensureScriptLoaded('libraries/hls.js', 'Hls');
    if (isLargeTarget) {
      if (!hlsLarge) {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          const finalUrl = await getPlayableUrl(activeUrl);
          hlsLarge = new Hls();
          hlsLarge.loadSource(finalUrl);
          hlsLarge.attachMedia(targetVideo);
          if (!(await nungguManifestHls(hlsLarge))) hlsLarge = null;
        } else if (targetVideo.canPlayType('application/vnd.apple.mpegurl')) {
          const finalUrl = await getPlayableUrl(activeUrl);
          targetVideo.src = finalUrl;
        }
      }
    } else {
      if (!hls) {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          const finalUrl = await getPlayableUrl(bestRequest.originalUrl);
          hls = new Hls();
          hls.loadSource(finalUrl);
          hls.attachMedia(targetVideo);
          if (!(await nungguManifestHls(hls))) hls = null;
        } else if (targetVideo.canPlayType('application/vnd.apple.mpegurl')) {
          const finalUrl = await getPlayableUrl(bestRequest.originalUrl);
          targetVideo.src = finalUrl;
        }
      }
    }
  };

  const syncPlayback = async (src, dest, isDestLarge) => {
    if (isSyncing) return;
    isSyncing = true;
    try {
      if (src.paused !== dest.paused) {
        if (src.paused) {
          dest.pause();
        } else {
          if (isStream) {
            await ensureHlsLoaded(dest, isDestLarge);
          } else if (!dest.src || dest.src === window.location.href) {
            dest.src = src.src || src.currentSrc;
          }
          dest.muted = dest.paused ? dest.muted : src.muted;
          dest.play().catch(e => console.warn("Sync play failed:", e));
        }
      }
      if (!isStream && Math.abs(src.currentTime - dest.currentTime) > 0.3) {
        dest.currentTime = src.currentTime;
      }
    } catch (err) {
      console.warn("Sync failed:", err);
    }
    isSyncing = false;
  };

  const header = document.createElement('div');
  header.classList.add('media-item-header');

  const checkbox = document.createElement('mdui-checkbox');
  checkbox.classList.add('media-checkbox');
  checkbox.checked = selectedUrls.has(bestRequest.originalUrl);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      selectedUrls.add(bestRequest.originalUrl);
    } else {
      selectedUrls.delete(bestRequest.originalUrl);
      const selectAll = document.getElementById('select-all-checkbox');
      if (selectAll) selectAll.checked = false;
    }
    updateSelectedCount();
  });
  header.appendChild(checkbox);

  const previewContainer = document.createElement('div');
  previewContainer.classList.add('media-preview-container');

  let video = null;

  if (isVideo || isStream) {
    previewContainer.classList.add('video');
    video = document.createElement('video');
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    mediaDiv.loadMediaPreview = () => {
      if (isStream || video.dataset.previewLoaded === '1') return;
      video.dataset.previewLoaded = '1';
      video.src = bestRequest.originalUrl;
      video.addEventListener('loadedmetadata', () => {
        if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration);
      }, { once: true });
    };
    if (!isStream) mediaPreviewLoadObserver.observe(mediaDiv);
    previewContainer.appendChild(video);

    video.addEventListener('play', () => {
      previewContainer.classList.add('playing');
      const isExpanded = mediaDiv.classList.contains('expanded');
      video.muted = isExpanded;
      if (largeVideo) largeVideo.muted = !isExpanded;
      if (largeVideo) syncPlayback(video, largeVideo, true);
    });
    video.addEventListener('pause', () => {
      previewContainer.classList.remove('playing');
      if (largeVideo) syncPlayback(video, largeVideo, true);
    });
    video.addEventListener('ended', () => {
      previewContainer.classList.remove('playing');
      if (largeVideo) syncPlayback(video, largeVideo, true);
    });
    video.addEventListener('timeupdate', () => {
      if (largeVideo) syncPlayback(video, largeVideo, true);
    });

    previewContainer.addEventListener('click', async (e) => {
      e.stopPropagation();
      mediaDiv.loadMediaPreview?.();
      if (video.paused) {
        document.querySelectorAll('.media-preview-container.playing video').forEach(v => {
          v.pause();
        });

        if (isStream && !hls) {
          await ensureScriptLoaded('libraries/hls.js', 'Hls');
          if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const finalUrl = await getPlayableUrl(bestRequest.originalUrl);
            hls = new Hls();
            hls.loadSource(finalUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              const isExpanded = mediaDiv.classList.contains('expanded');
              video.muted = isExpanded;
              video.play().catch(err => console.error("Playback failed:", err));
            });
            hls.on(Hls.Events.ERROR, () => { try { hls.destroy(); } catch (_) {} hls = null; });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            const finalUrl = await getPlayableUrl(bestRequest.originalUrl);
            video.src = finalUrl;
            const isExpanded = mediaDiv.classList.contains('expanded');
            video.muted = isExpanded;
            video.play().catch(err => console.error("Playback failed:", err));
          }
        } else {
          const isExpanded = mediaDiv.classList.contains('expanded');
          video.muted = isExpanded;
          video.play().catch(err => console.error("Playback failed:", err));
        }
      } else {
        video.pause();
      }
    });
  } else if (isImage) {
    const img = document.createElement('img');
    img.dataset.src = bestRequest.originalUrl;
    imageThumbObserver.observe(img);
    img.loading = "lazy";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.onerror = () => {
      img.remove();
      const fallback = document.createElement('mdui-icon');
      fallback.classList.add('media-preview-icon');
      fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z"/></svg>`;
      previewContainer.appendChild(fallback);
    };
    previewContainer.appendChild(img);
  } else {
    const mediaIconContainer = document.createElement('mdui-icon');
    mediaIconContainer.classList.add('media-preview-icon');
    const mediaIcon = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
    mediaIcon.setAttribute('viewBox', '0 -960 960 960');
    let path = document.createElementNS("http://www.w3.org/2000/svg", 'path');

    if (isAudio) {
      path.setAttribute('d', 'M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z');
    } else if (isSubtitle) {
      path.setAttribute('d', 'M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm120-120h120v-40H280v40Zm0-80h120v-40H280v40Zm280 80h120v-40H560v40Zm0-80h120v-40H560v40ZM160-240v-480 480Z');
    } else {
      path.setAttribute('d', 'M40-480q0-92 34.5-172T169-791.5q60-59.5 140-94T480-920q91 0 171 34.5t140 94Q851-732 885.5-652T920-480h-80q0-75-28.5-140.5T734-735q-49-49-114.5-77T480-840q-74 0-139.5 28T226-735q-49 49-77.5 114.5T120-480H40Zm160 0q0-118 82-199t198-81q116 0 198 81t82 199h-80q0-83-58.5-141.5T480-680q-83 0-141.5 58.5T280-480h-80ZM360-64l-56-56 136-136v-132q-27-12-43.5-37T380-480q0-42 29-71t71-29q42 0 71 29t29 71q0 30-16.5 55T520-388v132l136 136-56 56-120-120L360-64Z');
    }
    mediaIcon.appendChild(path);
    mediaIconContainer.appendChild(mediaIcon);
    previewContainer.appendChild(mediaIconContainer);
  }
  header.appendChild(previewContainer);

  const info = document.createElement('div');
  info.classList.add('media-item-info');

  const headline = document.createElement('div');
  headline.classList.add('media-headline');
  const displayTitle = item.resolvedFilename || mediaFilename.resolve(bestRequest?.originalUrl || bestRequest?.url || "", bestRequest || {});
  headline.textContent = displayTitle;
  info.appendChild(headline);

  const description = document.createElement('div');
  description.classList.add('media-description');
  const timeValue = Number(bestRequest.timeStamp) || 0;
  const timeStr = timeValue > 0 ? new Date(timeValue).toLocaleTimeString() : '';
  const humanSize = getHumanReadableSize(bestRequest.size);

  let resLabel = '';
  if (ytFormats && ytFormats.length > 0 && ytFormats[0].label) {
    resLabel = ` • ${ytFormats[0].label}`;
  }
  description.dataset.mediaHost = mediaURL.hostname;
  description.dataset.mediaTime = timeStr;
  description.dataset.mediaResolution = resLabel;
  const hostLabel = mediaURL.hostname || (() => { try { return new URL(bestRequest.pageUrl || '').hostname; } catch (_) { return ''; } })();
  description.textContent = [hostLabel, humanSize + resLabel, timeStr].filter(Boolean).join(' • ');
  info.appendChild(description);
  header.appendChild(info);

  const qrBtn = document.createElement('mdui-button-icon');
  qrBtn.innerHTML = `<mdui-icon><svg viewBox="0 -960 960 960"><path d="M120-120v-240h80v160h160v80H120Zm0-480v-240h240v80H200v160h-80Zm480 480v-80h160v-160h80v240H600Zm160-480v-160H600v-80h240v240h-80ZM280-280v-120h120v120H280Zm0-280v-120h120v120H280Zm280 280v-120h120v120H560Zm0-280v-120h120v120H560Z"/></svg></mdui-icon>`;
  qrBtn.title = browser.i18n.getMessage("qrCodeButton") || "QR Code";
  qrBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showQRCode(activeUrl);
  });
  header.appendChild(qrBtn);
  mediaDiv.appendChild(header);

  function gawePratinjauGede() {
    if (largeVideo) return largeVideo;
    inlinePreview = document.createElement('div');
    inlinePreview.classList.add('inline-preview-area');
    largeVideo = document.createElement('video');
    largeVideo.controls = true;
    inlinePreview.appendChild(largeVideo);
    if (actionsWrapper.parentNode === mediaDiv) mediaDiv.insertBefore(inlinePreview, actionsWrapper);
    else mediaDiv.appendChild(inlinePreview);
    largeVideo.addEventListener('play', () => {
      if (!video) return;
      const isExpanded = mediaDiv.classList.contains('expanded');
      largeVideo.muted = !isExpanded;
      video.muted = isExpanded;
      syncPlayback(largeVideo, video, false);
    });
    largeVideo.addEventListener('pause', () => {
      if (!video) return;
      syncPlayback(largeVideo, video, false);
    });
    largeVideo.addEventListener('timeupdate', () => {
      if (!video) return;
      syncPlayback(largeVideo, video, false);
    });
    return largeVideo;
  }

  mediaDiv.cleanupMediaPreview = () => {
    mediaPreviewLoadObserver.unobserve(mediaDiv);
    if (hls) {
      hls.destroy();
      hls = null;
    }
    if (hlsLarge) {
      hlsLarge.destroy();
      hlsLarge = null;
    }
    mediaDiv.querySelectorAll('video').forEach(media => {
      media.pause();
      media.removeAttribute('src');
      media.load();
    });
    if (resolvedM3u8Url?.startsWith('blob:')) URL.revokeObjectURL(resolvedM3u8Url);
    resolvedM3u8Url = null;
  };

  if ((isVideo || isStream) && !ytFormats && typeof embedSubtitlesWithLibAV !== 'undefined') {
     browser.storage.local.get(['embed-subtitles-nonyt']).then(res => {
         const embedSubtitlesNonYt = res['embed-subtitles-nonyt'] === '1';
         if (embedSubtitlesNonYt) {
             const subtitles = allMediaRequests.filter(req => req.type === 'subtitle' || req.isSubtitle);
             if (subtitles.length > 0) {
                 const subRow = document.createElement('div');
                 subRow.classList.add('yt-resolution-row');
                 subRow.style.marginTop = '8px';
                 subRow.style.width = '100%';

                 const subButtonWrapper = document.createElement('div');
                 subButtonWrapper.classList.add('pill-select-wrapper', 'nonyt-subtitle-select-wrapper');
                 subButtonWrapper.style.width = '100%';

                 const subButton = document.createElement('button');
                 subButton.classList.add('pill-select');
                 subButton.style.textAlign = 'center';
                 subButton.style.display = 'flex';
                 subButton.style.alignItems = 'center';
                 subButton.style.justifyContent = 'center';
                 subButton.style.gap = '6px';
                 subButton.style.cursor = 'pointer';
                 subButton.style.width = '100%';
                 subButton.style.paddingRight = '32px';

                 const label = browser.i18n.getMessage("selectSubtitlesToEmbed") || "Select Subtitles";
                 subButton.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 4px; flex-shrink: 0;"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-4H6V8h12v4z"/></svg> <span class="sub-btn-text">${label} (0)</span>`;

                 subButton.addEventListener('click', (e) => {
                     e.stopPropagation();

                     const dialog = document.createElement('mdui-dialog');
                     dialog.headline = label;

                     const container = document.createElement('div');
                     container.style.display = 'flex';
                     container.style.flexDirection = 'column';
                     container.style.gap = '8px';
                     container.style.marginTop = '16px';
                     container.style.maxHeight = '250px';
                     container.style.overflowY = 'auto';

                     let currentSelected = [];
                     if (mediaDiv.dataset.selectedSubtitles) {
                         try {
                             currentSelected = JSON.parse(mediaDiv.dataset.selectedSubtitles);
                         } catch (err) {}
                     }

                     const checkboxes = [];
                     subtitles.forEach((sub) => {
                         const mduiCheckbox = document.createElement('mdui-checkbox');
                         mduiCheckbox.value = sub.bestRequest.originalUrl;
                         mduiCheckbox.style.fontSize = '0.85rem';
                         const name = sub.resolvedFilename || getFileName(sub.bestRequest.originalUrl);
                         mduiCheckbox.textContent = name;
                         if (currentSelected.includes(sub.bestRequest.originalUrl)) {
                             mduiCheckbox.checked = true;
                         }
                         container.appendChild(mduiCheckbox);
                         checkboxes.push(mduiCheckbox);
                     });
                     dialog.appendChild(container);

                     const cancelBtn = document.createElement('mdui-button');
                     cancelBtn.slot = "action";
                     cancelBtn.variant = "text";
                     cancelBtn.textContent = browser.i18n.getMessage("cancelButton") || "Cancel";
                     cancelBtn.addEventListener('click', () => {
                         dialog.open = false;
                     });

                     const selectBtn = document.createElement('mdui-button');
                     selectBtn.slot = "action";
                     selectBtn.variant = "tonal";
                     selectBtn.textContent = browser.i18n.getMessage("selectButton") || "Select";
                     selectBtn.addEventListener('click', () => {
                         const newSelected = [];
                         checkboxes.forEach(cb => {
                             if (cb.checked) {
                                 newSelected.push(cb.value);
                             }
                         });
                         mediaDiv.dataset.selectedSubtitles = JSON.stringify(newSelected);
                         const btnText = subButton.querySelector('.sub-btn-text');
                         if (btnText) {
                             btnText.textContent = `${label} (${newSelected.length})`;
                         }
                         dialog.open = false;
                     });

                     dialog.appendChild(cancelBtn);
                     dialog.appendChild(selectBtn);

                     document.body.appendChild(dialog);
                     dialog.open = true;

                     dialog.addEventListener('closed', () => {
                         dialog.remove();
                     });
                 });

                 subButtonWrapper.appendChild(subButton);
                 subRow.appendChild(subButtonWrapper);
                 actionsWrapper.insertBefore(subRow, actions);
             }
         }
     }).catch(err => console.error("Error reading embed-subtitles-nonyt setting:", err));
  }

  const actionsWrapper = document.createElement('div');
  actionsWrapper.classList.add('media-actions-wrapper');

  const isM3U8 = mediaURL.pathname.toLowerCase().includes('.m3u8');
  const isMPD = mediaURL.pathname.toLowerCase().includes('.mpd');
  if (isStream && (isM3U8 || isMPD)) {
    const resolutionRow = document.createElement('div');
    resolutionRow.classList.add('yt-resolution-row', 'stream-resolution-row');
    resolutionRow.style.display = 'none';
    resolutionRow.style.width = '100%';

    const resWrapper = document.createElement('div');
    resWrapper.classList.add('pill-select-wrapper');

    const resSelect = document.createElement('select');
    resSelect.classList.add('pill-select');

    const loadingOpt = document.createElement('option');
    loadingOpt.value = "";
    loadingOpt.textContent = browser.i18n.getMessage("loadingQualities") || "Loading qualities...";
    resSelect.appendChild(loadingOpt);

    resWrapper.appendChild(resSelect);
    resolutionRow.appendChild(resWrapper);
    actionsWrapper.appendChild(resolutionRow);

    const getVariantsPromise = loadStreamVariants(bestRequest.originalUrl, isMPD);

    getVariantsPromise.then(async (variants) => {
        resSelect.innerHTML = '';
        if (variants && variants.length > 0) {
            const settings = await browser.storage.local.get(["stream-quality", "auto-download-quality"]);
            const preference = settings["auto-download-quality"] || settings["stream-quality"] || "highest";

            const askOpt = document.createElement('option');
            askOpt.value = "";
            askOpt.textContent = browser.i18n.getMessage("askStreamQualityCheckbox") || "Ask every time";
            resSelect.appendChild(askOpt);

            variants.forEach((v) => {
                const opt = document.createElement('option');
                opt.value = isM3U8 ? `${v.resolution}@${v.bandwidth}` : `${v.resolution}@${v.bandwidth}@${v.id}`;
                const bwKbps = Math.round(v.bandwidth / 1000).toString();
                opt.textContent = `${v.resolution} (${bwKbps} kbps)`;
                resSelect.appendChild(opt);
            });

            let defaultVal = "";
            if (preference === "highest") {
                const highest = variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
                defaultVal = isM3U8 ? `${highest.resolution}@${highest.bandwidth}` : `${highest.resolution}@${highest.bandwidth}@${highest.id}`;
            } else if (preference === "lowest") {
                const lowest = variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
                defaultVal = isM3U8 ? `${lowest.resolution}@${lowest.bandwidth}` : `${lowest.resolution}@${lowest.bandwidth}@${lowest.id}`;
            }

            resSelect.value = defaultVal;
            mediaDiv.dataset.selectedResolution = defaultVal;

            resSelect.addEventListener('change', () => {
                const selectedResolution = resSelect.value;
                mediaDiv.dataset.selectedResolution = selectedResolution;
            });
            resolutionRow.style.display = 'flex';
        } else {
            resolutionRow.style.display = 'none';
        }
    }).catch(err => {
        console.error("Failed to load stream variants:", err);
        resolutionRow.style.display = 'none';
    });
  }

  if (ytFormats && ytFormats.length > 1) {
    const resolutionRow = document.createElement('div');
    resolutionRow.classList.add('yt-resolution-row');

    const formatWrapper = document.createElement('div');
    formatWrapper.classList.add('pill-select-wrapper', 'yt-format-select-wrapper');

    const formatSelect = document.createElement('select');
    formatSelect.classList.add('pill-select', 'yt-format-select');

    const codecWrapper = document.createElement('div');
    codecWrapper.classList.add('pill-select-wrapper', 'yt-codec-select-wrapper');

    const codecSelect = document.createElement('select');
    codecSelect.classList.add('pill-select', 'yt-codec-select');

    const resWrapper = document.createElement('div');
    resWrapper.classList.add('pill-select-wrapper', 'yt-resolution-select-wrapper');

    const resSelect = document.createElement('select');
    resSelect.classList.add('pill-select', 'yt-resolution-select');
    resSelect.id = 'yt-resolution-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

    const demuxers = [...new Set(ytFormats.map(fmt => fmt.demuxer))];
    demuxers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d.toUpperCase();
      formatSelect.appendChild(opt);
    });

    const defaultDemuxer = demuxers.includes('mp4') ? 'mp4' : demuxers[0];
    formatSelect.value = defaultDemuxer;

    function updateCodecDropdown() {
      codecSelect.innerHTML = '';
      const selectedDemuxer = formatSelect.value;
      const availableCodecs = [...new Set(ytFormats.filter(fmt => fmt.demuxer === selectedDemuxer).map(fmt => fmt.codec || 'UNKNOWN'))];

      availableCodecs.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        codecSelect.appendChild(opt);
      });

      if (availableCodecs.includes('AV1')) codecSelect.value = 'AV1';
      else if (availableCodecs.includes('VP9')) codecSelect.value = 'VP9';
      else if (availableCodecs.includes('H265')) codecSelect.value = 'H265';
      else if (availableCodecs.includes('H264')) codecSelect.value = 'H264';
      else codecSelect.value = availableCodecs[0];

      updateResolutionDropdown();
    }

    const langRow = document.createElement('div');
    langRow.classList.add('yt-resolution-row');
    langRow.style.marginTop = '8px';
    langRow.style.display = 'none';

    const langWrapper = document.createElement('div');
    langWrapper.classList.add('pill-select-wrapper', 'yt-language-select-wrapper');
    langWrapper.style.flex = '1';

    const langSelect = document.createElement('select');
    langSelect.classList.add('pill-select', 'yt-language-select');
    langWrapper.appendChild(langSelect);
    langRow.appendChild(langWrapper);

    const subWrapper = document.createElement('div');
    subWrapper.classList.add('pill-select-wrapper', 'yt-subtitle-select-wrapper');
    subWrapper.style.flex = '1';
    subWrapper.style.display = 'none';

    const subSelect = document.createElement('select');
    subSelect.classList.add('pill-select', 'yt-subtitle-select');
    subWrapper.appendChild(subSelect);
    langRow.appendChild(subWrapper);

    function updateResolutionDropdown() {
        resSelect.innerHTML = '';
        const selectedDemuxer = formatSelect.value;
        const selectedCodec = codecSelect.value;

        const availableFormats = ytFormats.filter(fmt =>
          fmt.demuxer === selectedDemuxer &&
          (fmt.codec === selectedCodec || (!fmt.codec && selectedCodec === 'UNKNOWN'))
        );

        const uniqueResolutions = [];
        const seenRes = new Set();
        availableFormats.forEach(fmt => {
            const resKey = fmt.label || `${fmt.width}x${fmt.height}`;
            if (!seenRes.has(resKey)) {
                seenRes.add(resKey);
                uniqueResolutions.push(fmt);
            }
        });

        uniqueResolutions.forEach((fmt) => {
          const opt = document.createElement('option');
          opt.value = fmt.label || `${fmt.width}x${fmt.height}`;
          let optLabel = fmt.label || `${fmt.width}x${fmt.height}`;
          if (fmt.contentLength) {
            optLabel += ` • ${getHumanReadableSize(fmt.contentLength)}`;
          }
          opt.textContent = optLabel;
          resSelect.appendChild(opt);
        });

        browser.storage.local.get(['auto-download-quality', 'stream-quality']).then(st => {
            const qualityPref = st['auto-download-quality'] || st['stream-quality'] || 'highest';
            if (qualityPref === 'lowest' && resSelect.options.length > 0) {
                resSelect.value = resSelect.options[resSelect.options.length - 1].value;
            } else if (qualityPref === 'highest' && resSelect.options.length > 0) {
                resSelect.value = resSelect.options[0].value;
            }
            updateLanguageDropdown();
        }).catch(() => {
            updateLanguageDropdown();
        });
    }

    function updateLanguageDropdown() {
        // Save current selection to restore it later
        const previousLangVal = langSelect.value;
        const previousSubVal = subSelect.value;

        langSelect.innerHTML = '';
        const selectedDemuxer = formatSelect.value;
        const selectedCodec = codecSelect.value;
        const selectedRes = resSelect.value;

        const matchingFormats = ytFormats.filter(fmt =>
          fmt.demuxer === selectedDemuxer &&
          (fmt.codec === selectedCodec || (!fmt.codec && selectedCodec === 'UNKNOWN')) &&
          ((fmt.label || `${fmt.width}x${fmt.height}`) === selectedRes)
        );

        let showLangRow = false;

        if (matchingFormats.length > 1 || matchingFormats.some(f => f.audioTrack)) {
            langWrapper.style.display = 'flex';
            showLangRow = true;

            const allOpt = document.createElement('option');
            allOpt.value = 'all';

            // Dinamis berdasarkan settings mux-all-audios
            browser.storage.local.get(['mux-all-audios']).then(res => {
                if (res['mux-all-audios'] === '1') {
                    allOpt.textContent = browser.i18n.getMessage("allLanguagesMux") || "All Languages (Embedded)";
                } else {
                    allOpt.textContent = browser.i18n.getMessage("allLanguagesZip") || "All Languages (ZIP)";
                }
            }).catch(() => {
                allOpt.textContent = browser.i18n.getMessage("allLanguagesZip") || "All Languages (ZIP)";
            });

            langSelect.appendChild(allOpt);

            matchingFormats.forEach(fmt => {
                const opt = document.createElement('option');
                opt.value = ytFormats.indexOf(fmt);
                opt.textContent = (fmt.audioTrack && fmt.audioTrack.display_name) ? fmt.audioTrack.display_name : "Original / Default";
                langSelect.appendChild(opt);
            });

            // Restore selection if it still exists
            if (previousLangVal && Array.from(langSelect.options).some(o => o.value === previousLangVal)) {
                langSelect.value = previousLangVal;
            }
        } else {
            langWrapper.style.display = 'none';
            if (matchingFormats[0]) {
                const opt = document.createElement('option');
                opt.value = ytFormats.indexOf(matchingFormats[0]);
                opt.textContent = "Default";
                langSelect.appendChild(opt);
            }
        }

        const ytSubtitles = item.ytSubtitles || null;
        if (ytSubtitles && ytSubtitles.length > 0) {
            subWrapper.style.display = 'flex';
            showLangRow = true;
            if (subSelect.children.length === 0) {
                const noneOpt = document.createElement('option');
                noneOpt.value = 'none';
                noneOpt.textContent = browser.i18n.getMessage("noSubtitles") || "No Subtitles";
                subSelect.appendChild(noneOpt);

                const allSubOpt = document.createElement('option');
                allSubOpt.value = 'all';
                browser.storage.local.get(['embed-subtitles-mkv']).then(res => {
                    if (res['embed-subtitles-mkv'] === '1') {
                        allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesMux") || "All Subtitles (Embedded)";
                    } else {
                        allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesZip") || "All Subtitles (ZIP)";
                    }
                }).catch(() => {
                    allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesZip") || "All Subtitles (ZIP)";
                });
                subSelect.appendChild(allSubOpt);

                ytSubtitles.forEach(sub => {
                    const opt = document.createElement('option');
                    opt.value = sub.vttUrl;
                    opt.textContent = sub.displayName || sub.language;
                    subSelect.appendChild(opt);
                });
            } else {
                // Dynamically update the text of the "all" option if needed
                const allSubOpt = Array.from(subSelect.options).find(o => o.value === 'all');
                if (allSubOpt) {
                    browser.storage.local.get(['embed-subtitles-mkv']).then(res => {
                        if (res['embed-subtitles-mkv'] === '1') {
                            allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesMux") || "All Subtitles (Embedded)";
                        } else {
                            allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesZip") || "All Subtitles (ZIP)";
                        }
                    }).catch(() => {
                        allSubOpt.textContent = browser.i18n.getMessage("allSubtitlesZip") || "All Subtitles (ZIP)";
                    });
                }
            }

            // Restore selection if it still exists
            if (previousSubVal && Array.from(subSelect.options).some(o => o.value === previousSubVal)) {
                subSelect.value = previousSubVal;
            }
        } else {
            subWrapper.style.display = 'none';
        }

        if (showLangRow) {
            langRow.style.display = 'flex';
        } else {
            langRow.style.display = 'none';
        }

        langSelect.dispatchEvent(new Event('change'));
    }


    formatSelect.addEventListener('change', updateCodecDropdown);
    codecSelect.addEventListener('change', updateResolutionDropdown);
    resSelect.addEventListener('change', updateLanguageDropdown);

    langSelect.addEventListener('change', () => {
      if (langSelect.value === '') return;

      if (langSelect.value === 'all') {
          const selectedDemuxer = formatSelect.value;
          const selectedCodec = codecSelect.value;
          const selectedRes = resSelect.value;
          const matchingFormats = ytFormats.filter(f =>
            f.demuxer === selectedDemuxer &&
            (f.codec === selectedCodec || (!f.codec && selectedCodec === 'UNKNOWN')) &&
            ((f.label || `${f.width}x${f.height}`) === selectedRes)
          );
          const firstFmt = matchingFormats[0];
          if (firstFmt) {
              activeUrl = firstFmt.videoUrl;
              activeAudioUrl = 'all';
              activeSize = firstFmt.contentLength || 'unknown';
              mediaDiv.dataset.url = activeUrl;
              mediaDiv.dataset.audioUrl = 'all';
              mediaDiv.dataset.size = activeSize;
              const newHumanSize = getHumanReadableSize(activeSize);
              const newResLabel = firstFmt.label ? ` • ${firstFmt.label}` : '';
              const hostLabel = mediaURL.hostname || description.dataset.mediaHost || '';
              description.textContent = `${hostLabel} • ${newHumanSize}${newResLabel} • ${timeStr}`;
          }
          return;
      }

      const selectedIdx = parseInt(langSelect.value);
      const fmt = ytFormats[selectedIdx];
      if (fmt) {
        activeUrl = fmt.videoUrl;
        activeAudioUrl = fmt.audioUrl || null;
        activeSize = fmt.contentLength || 'unknown';
        mediaDiv.dataset.url = activeUrl;
        mediaDiv.dataset.audioUrl = activeAudioUrl || '';
        mediaDiv.dataset.size = activeSize;

        const newHumanSize = getHumanReadableSize(activeSize);
        const newResLabel = fmt.label ? ` • ${fmt.label}` : '';
        const hostLabel = mediaURL.hostname || description.dataset.mediaHost || '';
        description.textContent = `${hostLabel} • ${newHumanSize}${newResLabel} • ${timeStr}`;
      }
    });

    formatWrapper.appendChild(formatSelect);
    resolutionRow.appendChild(formatWrapper);

    codecWrapper.appendChild(codecSelect);
    resolutionRow.appendChild(codecWrapper);

    resWrapper.appendChild(resSelect);
    resolutionRow.appendChild(resWrapper);

    actionsWrapper.appendChild(resolutionRow);
    actionsWrapper.appendChild(langRow);

    updateCodecDropdown();
  }

  const actions = document.createElement('div');
  actions.classList.add('media-actions');

  const buttonGroup = document.createElement('mdui-segmented-button-group');
  buttonGroup.style.width = '100%';

  const dlBtn = document.createElement('mdui-segmented-button');
  dlBtn.id = 'download-button';
  dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>${browser.i18n.getMessage("downloadButton") || "Download"}`;
  if (isSubtitle || isFile) dlBtn.style.borderRadius = '100px';
  dlBtn.addEventListener('click', () => {
    if (dlBtn.classList.contains('is-paused')) {
      const dlId = mediaDiv.dataset.downloadId;
      if (dlId) {
        browser.runtime.sendMessage({ action: 'resumeActiveDownload', id: dlId });
        updatePausePlayUI(dlBtn, false);
        if (window.activePauses) {
          window.activePauses.delete(dlId);
          if (activeUrl) window.activePauses.delete(activeUrl);
          if (activeAudioUrl) window.activePauses.delete(activeAudioUrl);
        }
      }
    } else if (dlBtn.classList.contains('is-playing')) {
      const dlId = mediaDiv.dataset.downloadId;
      if (dlId) {
        browser.runtime.sendMessage({ action: 'pauseDownload', id: dlId });
        updatePausePlayUI(dlBtn, true);
        if (window.activePauses) {
          window.activePauses.add(dlId);
          if (activeUrl) window.activePauses.add(activeUrl);
          if (activeAudioUrl) window.activePauses.add(activeAudioUrl);
        }
      }
    } else {
      const subSelect = mediaDiv.querySelector('.yt-subtitle-select');
      const activeSubtitleUrl = (subSelect && subSelect.value && subSelect.value !== 'none') ? subSelect.value : null;
      downloadFile(activeUrl, mediaDiv, activeSize, false, activeAudioUrl, activeSubtitleUrl);
    }
  });

  const prvBtn = document.createElement('mdui-segmented-button');
  prvBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="m380-300 280-180-280-180v360ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg></mdui-icon>${browser.i18n.getMessage("previewMedia") || "Preview"}`;
  if (isSubtitle || isFile) prvBtn.style.display = 'none';

  prvBtn.addEventListener('click', async () => {
      const isExpanded = mediaDiv.classList.toggle('expanded');

      if (isExpanded) {
        gawePratinjauGede();
        if (isImage) {
          largeVideo.style.display = 'none';
          let largeImg = inlinePreview.querySelector('img');
          if (!largeImg) {
            largeImg = document.createElement('img');
            largeImg.style.width = "100%";
            largeImg.style.height = "100%";
            largeImg.style.objectFit = "contain";
            inlinePreview.appendChild(largeImg);
          }
          largeImg.src = activeUrl;
          largeImg.style.display = 'block';
        } else {
          const largeImg = inlinePreview.querySelector('img');
          if (largeImg) largeImg.style.display = 'none';
          largeVideo.style.display = 'block';

          if (isStream) {
            await ensureScriptLoaded('libraries/hls.js', 'Hls');
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
              const finalUrl = await getPlayableUrl(activeUrl);
              hlsLarge = new Hls();
              hlsLarge.loadSource(finalUrl);
              hlsLarge.attachMedia(largeVideo);
              hlsLarge.on(Hls.Events.MANIFEST_PARSED, () => {
                largeVideo.play().catch(e => console.warn("Auto-play failed:", e));
              });
              hlsLarge.on(Hls.Events.ERROR, () => { try { hlsLarge.destroy(); } catch (_) {} hlsLarge = null; });
            } else if (largeVideo.canPlayType('application/vnd.apple.mpegurl')) {
              const finalUrl = await getPlayableUrl(activeUrl);
              largeVideo.src = finalUrl;
              largeVideo.play().catch(e => console.warn("Auto-play failed:", e));
            }
          } else {
            largeVideo.src = activeUrl;
            largeVideo.play().catch(e => console.warn("Auto-play failed:", e));
          }
        }
        prvBtn.setAttribute('selected', '');
      } else {
        if (largeVideo) {
          largeVideo.pause();
          largeVideo.src = "";
        }
        const largeImg = inlinePreview ? inlinePreview.querySelector('img') : null;
        if (largeImg) largeImg.src = "";

        if (hlsLarge) {
          hlsLarge.destroy();
          hlsLarge = null;
        }
        prvBtn.removeAttribute('selected');
      }
  });

  const audioBtn = document.createElement('mdui-segmented-button');
  audioBtn.id = 'audio-only-button';
  audioBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z"/></svg></mdui-icon>${browser.i18n.getMessage("audioOnly") || "Audio-Only"}`;
  audioBtn.addEventListener('click', () => {
    if (activeAudioUrl) {
        downloadAudioOnly(activeAudioUrl, mediaDiv, activeSize);
    } else {
        downloadAudioOnly(activeUrl, mediaDiv, activeSize);
    }
  });
  if (!isVideo && !isStream) audioBtn.style.display = 'none';

  const cancelBtn = document.createElement('mdui-segmented-button');
  cancelBtn.id = 'cancel-button';
  cancelBtn.style.display = 'none';
  cancelBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></mdui-icon>${browser.i18n.getMessage("cancelButton") || "Cancel"}`;

  cancelBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const dlId = mediaDiv.dataset.downloadId;
    window.activeCancellations.add(activeUrl);
    if (window.activeAbortControllers.has(activeUrl)) {
      window.activeAbortControllers.get(activeUrl).abort();
    }
    if (activeAudioUrl) {
      window.activeCancellations.add(activeAudioUrl);
      if (window.activeAbortControllers.has(activeAudioUrl)) {
        window.activeAbortControllers.get(activeAudioUrl).abort();
      }
    }
    if (dlId) {
      window.activeCancellations.add(dlId);
      if (window.activePauses) window.activePauses.delete(dlId);
    }
    if (window.activePauses) {
      window.activePauses.delete(activeUrl);
      if (activeAudioUrl) window.activePauses.delete(activeAudioUrl);
    }
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
        browser.tabs.sendMessage(activeTab.id, { action: 'cancelDownload', url: activeUrl }).catch(() => {});
        if (activeAudioUrl) {
          browser.tabs.sendMessage(activeTab.id, { action: 'cancelDownload', url: activeAudioUrl }).catch(() => {});
        }
      }
    } catch(e) {}
    browser.runtime.sendMessage({ action: 'cancelDownload', url: activeUrl, id: dlId });
    if (activeAudioUrl) {
      browser.runtime.sendMessage({ action: 'cancelDownload', url: activeAudioUrl, id: dlId });
    }
    if (mediaDiv.dataset.recoveryJob) {
      browser.runtime.sendMessage({ action: 'releasePopupRecovery', jobId: mediaDiv.dataset.recoveryJob }).catch(() => {});
      delete mediaDiv.dataset.recoveryJob;
    }
    finishDownloadUI(dlId || activeUrl, false);
  });
  dlBtn.style.flex = '1.0';
  buttonGroup.appendChild(dlBtn);

  if (isVideo || isStream) {
    audioBtn.style.flex = '1';
    buttonGroup.appendChild(audioBtn);
  }

  cancelBtn.style.flex = '1';
  buttonGroup.appendChild(cancelBtn);

  if (!(isSubtitle || isFile)) {
    prvBtn.style.flex = '1';
    buttonGroup.appendChild(prvBtn);
  }

  actions.appendChild(buttonGroup);
  actionsWrapper.appendChild(actions);
  mediaDiv.appendChild(actionsWrapper);

  uiCache.set(bestRequest.originalUrl, { element: mediaDiv, dlBtn, audioBtn, prvBtn, cancelBtn });

  return mediaDiv;
}
