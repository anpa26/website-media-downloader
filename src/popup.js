// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
  var browser = chrome;
}

let downloadingCount = 0;
let ratingCount = 0;
sessionStorage.setItem('shownYoutubeAlert', 0); 

document.addEventListener('DOMContentLoaded', async () => {
  const colorResult = await browser.storage.local.get('theme-color');
  mdui.setColorScheme(colorResult['theme-color'] || '#bbdefb');

  // Restore state if reloaded
  const savedTab = sessionStorage.getItem('activeTab');
  const savedScroll = sessionStorage.getItem('scrollPos');
  if (savedTab) {
    document.getElementById('navbar').value = savedTab;
    if (savedTab === 'history') loadHistoryList();
  }
  if (savedScroll) {
    window.scrollTo(0, parseInt(savedScroll));
  }

  loadMediaList();
  document.getElementById('navbar').addEventListener('change', (event) => {
    const selectedTab = document.getElementById('navbar').value;
    sessionStorage.setItem('activeTab', selectedTab);
    if (selectedTab === 'history') {
      loadHistoryList();
    }
  });

  const historyPageResult = await browser.storage.local.get('history-page');
  if (historyPageResult['history-page'] === '1' || historyPageResult['history-page'] === true) {
    document.getElementById('history-tab').style.display = 'inline-flex';
  }

  // Watch for history-page setting changes
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['history-page']) {
      // Save current state before reload
      sessionStorage.setItem('activeTab', document.getElementById('navbar').value);
      sessionStorage.setItem('scrollPos', window.scrollY);
      location.reload();
    }
  });

  document.getElementById('clear-history').addEventListener('click', () => clearHistory());


  document.getElementById('refresh-list').addEventListener('click', () => loadMediaList());
  document.getElementById('clear-list').addEventListener('click', () => clearMediaList());

  document.getElementById('help-button').addEventListener('click', async () => {
    try {
      const response = await fetch(browser.runtime.getURL('changelog.json'));
      const data = await response.json();
      const lang = browser.i18n.getUILanguage().split('-')[0];
      const content = data[lang] || data['en'];
      const version = browser.runtime.getManifest().version;
      
      const headlineHtml = `
        <div style="display: flex; align-items: baseline; justify-content: space-between; width: 100%;">
          <span>${content.headline}</span>
          <span style="opacity: 0.5; font-size: 0.8rem; font-weight: normal; margin-left: 16px;">v${version}</span>
        </div>`;
        
      const changelogHtml = `<ul style="padding-left: 20px; margin: 0;">${content.changes.map(change => `<li>${change}</li>`).join('')}</ul>`;
      
      const githubButton = document.createElement('mdui-button');
      githubButton.variant = "text";
      githubButton.href = "https://github.com/anpa26/website-media-downloader";
      githubButton.target = "_blank";
      githubButton.style.marginRight = "auto";
      githubButton.style.marginLeft = "-8px";
      githubButton.innerHTML = `
        <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> GitHub Repository
      `;

      showDialog(changelogHtml, headlineHtml, [githubButton]);
    } catch (e) {
      console.error("Failed to load changelog:", e);
      const githubButton = document.createElement('mdui-button');
      githubButton.variant = "text";
      githubButton.href = "https://github.com/anpa26/website-media-downloader";
      githubButton.target = "_blank";
      githubButton.style.marginRight = "auto";
      githubButton.style.marginLeft = "-8px";
      githubButton.innerHTML = `
        <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></mdui-icon> GitHub Repository
      `;
      showDialog("Visit our GitHub for the latest updates.", "Changelog", [githubButton]);
    }
  });

  checkAndShowRatingBanner();
  document.getElementById('dont-show-again-button').addEventListener('click', () => dismissRatingBanner());

  document.getElementById('remind-me-later-button').addEventListener('click', async () => {
    const ratingBanner = document.getElementById('rating-banner');
    ratingBanner.style.display = 'none';
    await browser.storage.local.set({ 'install-date': Temporal.Now.plainDateISO().toString() });
  });

  document.getElementById('rate-now-button').addEventListener('click', async () => {
    res = await fetch("https://addons.mozilla.org/api/v5/addons/addon/media-downloader-unleashed/");
    data = await res.json();
    ratingCount = data.ratings.count;
    await browser.storage.local.set({ 'ratings-at-attempt': ratingCount.toString() });
    onfocus = async () => {
      res = await fetch("https://addons.mozilla.org/api/v5/addons/addon/media-downloader-unleashed/");
      data = await res.json();
      if (data.ratings.count > ratingCount) dismissRatingBanner();
      await browser.storage.local.remove("ratings-at-attempt");
      onfocus = null;
    };
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('options') === 'true') {
    document.getElementById('navbar').value = 'settings';
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'downloadProgress') {
    updateProgressUI(message.id || message.url, message.loaded, message.total);
  } else if (message.action === 'downloadComplete') {
    finishDownloadUI(message.id || message.url);
  } else if (message.action === 'downloadError') {
    finishDownloadUI(message.id || message.url);
    if (message.error === "USER_CANCELED") {
      if (typeof mdui !== 'undefined' && mdui.snackbar) {
        mdui.snackbar({
          message: browser.i18n.getMessage("downloadCancelled") || "Download cancelled",
          placement: "top"
        });
      }
      return;
    }
    showDialog(browser.i18n.getMessage("downloadError", [message.error]) || ("Download error: " + message.error));
  }
});

const uiCache = new Map();

function updateProgressUI(id, loaded, total) {
  let item = uiCache.get(id);
  
  if (!item) {
    const mediaItems = document.querySelectorAll('.media-item');
    for (const el of mediaItems) {
      if (el.dataset.downloadId === id || el.dataset.url === id) {
        const loadingBar = el.querySelector('mdui-linear-progress');
        const statusInfo = el.querySelector('.download-status-info');
        if (loadingBar && statusInfo) {
          item = { loadingBar, statusInfo, element: el };
          uiCache.set(id, item);
          // Also cache by the other identifier if possible
          if (el.dataset.downloadId) uiCache.set(el.dataset.downloadId, item);
          if (el.dataset.url) uiCache.set(el.dataset.url, item);
        }
        break;
      }
    }
  }

  if (item) {
    const { loadingBar, statusInfo } = item;
    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
    if (total > 0) {
      const totalMB = (total / (1024 * 1024)).toFixed(2);
      const percent = Math.round((loaded / total) * 100);
      const remainingMB = ((total - loaded) / (1024 * 1024)).toFixed(2);
      statusInfo.textContent = `${loadedMB} MB / ${totalMB} MB (${percent}%) • ${remainingMB} MB remaining`;
      loadingBar.indeterminate = false;
      loadingBar.max = total;
      loadingBar.value = loaded;
    } else {
      statusInfo.textContent = `${loadedMB} MB downloaded`;
      if (loadingBar.indeterminate !== true && !loadingBar.value) {
          loadingBar.indeterminate = true;
      }
    }
  }
}

function finishDownloadUI(id) {
  const itemData = uiCache.get(id);
  if (itemData) {
      const { element, loadingBar, statusInfo } = itemData;
      if (loadingBar && loadingBar.parentNode === element) element.removeChild(loadingBar);
      if (statusInfo && statusInfo.parentNode === element) element.removeChild(statusInfo);
      
      const dlBtn = element.querySelector('#download-button');
      if (dlBtn) {
        dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>Download`;
        dlBtn.classList.remove('cancel-active');
        dlBtn.disabled = false;
      }
      uiCache.delete(id);
      updateDownloadingCount(-1);
      return;
  }
  
  // Fallback if not in cache
  const mediaItems = document.querySelectorAll('.media-item');
  mediaItems.forEach(item => {
    if (item.dataset.downloadId === id || item.dataset.url === id) {
      const loadingBar = item.querySelector('mdui-linear-progress');
      const statusInfo = item.querySelector('.download-status-info');
      if (loadingBar) item.removeChild(loadingBar);
      if (statusInfo) item.removeChild(statusInfo);

      // Reset button to Download
      const dlBtn = item.querySelector('#download-button');
      if (dlBtn) {
        dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>Download`;
        dlBtn.classList.remove('cancel-active');
        dlBtn.disabled = false;
      }

      updateDownloadingCount(-1);
    }
  });
}

async function checkAndShowRatingBanner() {
  if(typeof Temporal !== 'undefined') {
    const installData = await browser.storage.local.get('install-date');
    if (!installData['install-date']) {
      await browser.storage.local.set({ 'install-date': Temporal.Now.plainDateISO().toString() });
      return;
    }
    const installDate = Temporal.PlainDate.from(installData['install-date']);
    const hasRated = (await browser.storage.local.get('has-rated'))['has-rated'];
    const now = Temporal.Now.plainDateISO();
    if (now.since(installDate).days >= 7 && !hasRated) {
      document.getElementById('rating-banner').removeAttribute("style");
    }
  }
}

async function dismissRatingBanner() {
  document.getElementById('rating-banner').style.display = 'none';
  await browser.storage.local.set({ 'has-rated': 'true' });
}

function updateDownloadingCount(change) {
  downloadingCount = Math.max(0, downloadingCount + change);
  document.title = downloadingCount > 0 ? `${downloadingCount}` : "Website Media Downloader";
}

function showDialog(message, title = null, extraActions = []) {
  const dialog = document.createElement('mdui-dialog');
  
  if (title && typeof title === 'string' && title.includes('<')) {
    const headline = document.createElement('div');
    headline.setAttribute('slot', 'headline');
    headline.style.width = '100%';
    headline.innerHTML = title;
    dialog.appendChild(headline);
  } else {
    dialog.headline = title || "Changelog";
  }

  const description = document.createElement('div');
  description.setAttribute('slot', 'description');
  description.innerHTML = message;
  dialog.appendChild(description);

  if (Array.isArray(extraActions)) {
    extraActions.forEach(action => {
      action.setAttribute('slot', 'action');
      dialog.appendChild(action);
    });
  }

  const okButton = document.createElement('mdui-button');
  okButton.variant = "text";
  okButton.textContent = browser.i18n.getMessage("okButton") || "OK";
  okButton.slot = 'action';
  okButton.style.marginRight = "-8px";
  okButton.addEventListener('click', () => {
    dialog.open = false;
  });
  dialog.appendChild(okButton);
  
  document.body.appendChild(dialog);
  dialog.open = true;

  dialog.addEventListener('closed', () => {
    dialog.remove();
  });
}

function loadMediaList() {
  const mediaContainer = document.getElementById('media-list');
  const loadingSpinner = document.getElementById('loading-media-list');
  const globalLoading = document.getElementById('loading');
  const mainContent = document.getElementById('main-content');

  if (loadingSpinner) loadingSpinner.style.display = 'block';
  
  // Preserve active download items to avoid flickering
  const activeItems = new Map();
  mediaContainer.querySelectorAll('.media-item').forEach(item => {
    if (item.querySelector('mdui-linear-progress')) {
      activeItems.set(item.dataset.url, item);
    }
  });

  mediaContainer.innerHTML = ''; 
  activeItems.forEach(item => mediaContainer.appendChild(item));

  browser.runtime.sendMessage({ action: 'getMediaRequests' }).then(async (mediaRequests) => {
    if (globalLoading) globalLoading.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
    
    if (!mediaRequests || Object.keys(mediaRequests).length === 0) {
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        if (activeItems.size === 0) {
          mediaContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noMediaDetected")}</div>`;
        }
        return;
    }

    const onlyMedia = (await browser.storage.local.get('only-media'))['only-media'] !== '0'; // Default to true
    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"]
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];

    const mediaGroups = new Map();
    for (const rawUrl in mediaRequests) {
      if (activeItems.has(rawUrl)) continue;

      let mediaURL;
      try { mediaURL = new URL(rawUrl); } catch (e) { continue; }
      const requests = mediaRequests[rawUrl];
      if (!Array.isArray(requests) || requests.length === 0) continue;

      const path = mediaURL.pathname.toLowerCase();
      const isVideo = videoExtensions.some(ext => path.endsWith(ext)) || requests.some(req => req.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && h.value.startsWith("video/")));
      const isAudio = audioExtensions.some(ext => path.endsWith(ext)) || requests.some(req => req.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && h.value.startsWith("audio/")));
      const isStream = streamExtensions.some(ext => path.endsWith(ext)) || requests.some(req => req.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && (h.value.includes("mpegurl") || h.value.includes("dash+xml"))));

      if (onlyMedia && !isVideo && !isAudio && !isStream) continue;
      
      // Use URL without common tracking params as identity to distinguish qualities
      const identity = rawUrl.split('?')[0]; 
      if (!mediaGroups.has(identity)) mediaGroups.set(identity, { requests: [], isVideo, isAudio, isStream });
      const group = mediaGroups.get(identity);
      
      requests.forEach(req => {
        const existingIdx = group.requests.findIndex(r => r.originalUrl === rawUrl);
        if (existingIdx === -1) {
          group.requests.push({ ...req, originalUrl: rawUrl });
        } else {
          // If we see the same URL again, keep the one with the larger size (better detection)
          const currentSize = parseInt(req.size) || 0;
          const existingSize = parseInt(group.requests[existingIdx].size) || 0;
          if (currentSize > existingSize) {
            group.requests[existingIdx] = { ...req, originalUrl: rawUrl };
          }
        }
      });
    }

    // Flatten and sort globally by size
    const flattenedRequests = [];
    mediaGroups.forEach(group => {
        group.requests.sort((a, b) => (parseInt(b.size) || 0) - (parseInt(a.size) || 0));
        flattenedRequests.push({ 
          bestRequest: group.requests[0], 
          isVideo: group.isVideo, 
          isAudio: group.isAudio, 
          isStream: group.isStream 
        });
    });
    
    flattenedRequests.sort((a, b) => (parseInt(b.bestRequest.size) || 0) - (parseInt(a.bestRequest.size) || 0));

    if (flattenedRequests.length === 0 && activeItems.size === 0) {
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      mediaContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noMediaDetected")}</div>`;
      return;
    }

    for (const item of flattenedRequests) {
      const { bestRequest, isVideo, isAudio, isStream } = item;
      const mediaURL = new URL(bestRequest.originalUrl);
      const mediaDiv = document.createElement('mdui-list-item');
      mediaDiv.setAttribute('nonclickable', 'true');
      mediaDiv.classList.add('media-item');
      mediaDiv.dataset.url = bestRequest.originalUrl; // Set for progress tracking

      const previewContainer = document.createElement('div');
      previewContainer.classList.add('media-preview-container');
      previewContainer.setAttribute('slot', 'icon');

      if (isVideo || isStream) {
        previewContainer.classList.add('video');
        const video = document.createElement('video');
        video.src = isStream ? "" : bestRequest.originalUrl;
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        if (!isStream) video.currentTime = 0.1;
        previewContainer.appendChild(video);
        
        let hls = null;
        previewContainer.addEventListener('click', (e) => {
          e.stopPropagation();
          if (video.paused) {
            // Pause all other playing videos first
            document.querySelectorAll('.media-preview-container.playing video').forEach(v => {
              v.pause();
              v.parentElement.classList.remove('playing');
            });

            if (isStream && !video.src) {
              if (Hls.isSupported()) {
                hls = new Hls();
                hls.loadSource(bestRequest.originalUrl);
                hls.attachMedia(video);
              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = bestRequest.originalUrl;
              }
            }
            
            video.muted = false;
            video.play().then(() => {
              previewContainer.classList.add('playing');
            }).catch(err => console.error("Playback failed:", err));
          } else {
            video.pause();
            previewContainer.classList.remove('playing');
          }
        });
      } else {
        const mediaIconContainer = document.createElement('mdui-icon');
        mediaIconContainer.classList.add('media-preview-icon');
        const mediaIcon = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
        mediaIcon.setAttribute('viewBox', '0 -960 960 960');
        let path = document.createElementNS("http://www.w3.org/2000/svg", 'path');

        if (isAudio) {
          path.setAttribute('d', 'M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z');
        } else {
          path.setAttribute('d', 'M40-480q0-92 34.5-172T169-791.5q60-59.5 140-94T480-920q91 0 171 34.5t140 94Q851-732 885.5-652T920-480h-80q0-75-28.5-140.5T734-735q-49-49-114.5-77T480-840q-74 0-139.5 28T226-735q-49 49-77.5 114.5T120-480H40Zm160 0q0-118 82-199t198-81q116 0 198 81t82 199h-80q0-83-58.5-141.5T480-680q-83 0-141.5 58.5T280-480h-80ZM360-64l-56-56 136-136v-132q-27-12-43.5-37T380-480q0-42 29-71t71-29q42 0 71 29t29 71q0 30-16.5 55T520-388v132l136 136-56 56-120-120L360-64Z');
        }
        mediaIcon.appendChild(path);
        mediaIconContainer.appendChild(mediaIcon);
        previewContainer.appendChild(mediaIconContainer);
      }
      mediaDiv.appendChild(previewContainer);

      const cardContent = document.createElement('div');
      cardContent.classList.add('media-item-content');

      // Create large inline preview area
      const inlinePreview = document.createElement('div');
      inlinePreview.classList.add('inline-preview-area');
      const largeVideo = document.createElement('video');
      largeVideo.controls = true;
      inlinePreview.appendChild(largeVideo);
      mediaDiv.appendChild(inlinePreview);
      
      mediaDiv.appendChild(cardContent);

      const headline = document.createElement('div');
      headline.setAttribute('slot', 'headline');
      headline.textContent = getFileName(bestRequest.originalUrl);
      cardContent.appendChild(headline);

      const description = document.createElement('div');
      description.setAttribute('slot', 'description');
      const timeStr = new Date(bestRequest.timeStamp).toLocaleTimeString();
      const humanSize = getHumanReadableSize(bestRequest.size);
      description.textContent = `${mediaURL.hostname} • ${humanSize} • ${timeStr}`;
      cardContent.appendChild(description);

      const actionsArea = document.createElement('div');
      actionsArea.classList.add('media-actions');
      cardContent.appendChild(actionsArea);

      const buttonGroup = document.createElement('mdui-segmented-button-group');
      buttonGroup.style.width = '100%';

      const dlBtn = document.createElement('mdui-segmented-button');
      dlBtn.id = 'download-button';
      dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg></mdui-icon>Download`;
      dlBtn.addEventListener('click', () => {
        if (dlBtn.classList.contains('cancel-active')) {
          browser.runtime.sendMessage({ action: 'cancelDownload', url: bestRequest.originalUrl });
          // Provide immediate feedback
          dlBtn.disabled = true;
          const statusInfo = mediaDiv.querySelector('.download-status-info');
          if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("downloadCancelled") || "Cancelling...";
        } else {
          downloadFile(bestRequest.originalUrl, mediaDiv, bestRequest.size);
        }
      });
      
      const prvBtn = document.createElement('mdui-segmented-button');
      prvBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="m380-300 280-180-280-180v360ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg></mdui-icon>Preview`;
      
      let hlsLarge = null;
      prvBtn.addEventListener('click', () => {
          const isExpanded = mediaDiv.classList.toggle('expanded');
          
          if (isExpanded) {
            if (isStream) {
              if (Hls.isSupported()) {
                hlsLarge = new Hls();
                hlsLarge.loadSource(bestRequest.originalUrl);
                hlsLarge.attachMedia(largeVideo);
              } else if (largeVideo.canPlayType('application/vnd.apple.mpegurl')) {
                largeVideo.src = bestRequest.originalUrl;
              }
            } else {
              largeVideo.src = bestRequest.originalUrl;
            }
            largeVideo.play().catch(e => console.warn("Auto-play failed:", e));
            prvBtn.setAttribute('selected', '');
          } else {
            largeVideo.pause();
            largeVideo.src = "";
            if (hlsLarge) {
              hlsLarge.destroy();
              hlsLarge = null;
            }
            prvBtn.removeAttribute('selected');
          }
      });

      buttonGroup.appendChild(dlBtn);
      buttonGroup.appendChild(prvBtn);
      actionsArea.appendChild(buttonGroup);
      mediaContainer.appendChild(mediaDiv);
    }

    if (loadingSpinner) loadingSpinner.style.display = 'none';
    const endMsg = document.createElement('div');
    endMsg.id = "end-of-media-list";
    endMsg.style.textAlign = 'center';
    endMsg.style.padding = '20px 0 100px';
    endMsg.innerHTML = browser.i18n.getMessage("endOfMediaList");
    mediaContainer.appendChild(endMsg);

    // Restore active downloads UI
    browser.runtime.sendMessage({ action: 'getActiveDownloads' }).then((activeDownloads) => {
      if (!activeDownloads) return;
      Object.keys(activeDownloads).forEach(id => {
        const downloadData = activeDownloads[id];
        const url = downloadData.url;

        // Find the item. Match by id if available, or by URL
        const item = Array.from(document.querySelectorAll('.media-item')).find(el =>
          el.dataset.downloadId === id || el.dataset.url === url || url.startsWith(el.dataset.url.split('?')[0])
        );

        if (item && !item.querySelector('mdui-linear-progress')) {
          item.dataset.downloadId = id; // Sync with background ID
          item.dataset.url = url; 
          const loadingBar = document.createElement('mdui-linear-progress');
          const statusInfo = document.createElement('div');
          statusInfo.className = 'download-status-info';
          statusInfo.style.fontSize = '12px';
          statusInfo.style.marginTop = '4px';
          statusInfo.style.textAlign = 'center';
          item.appendChild(loadingBar);
          item.appendChild(statusInfo);

          // Restore Cancel button state
          const dlBtn = item.querySelector('#download-button');
          if (dlBtn) {
            dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></mdui-icon>${browser.i18n.getMessage("cancelButton") || "Cancel"}`;
            dlBtn.classList.add('cancel-active');
          }

          updateDownloadingCount(1);
          updateProgressUI(id, downloadData.loaded, downloadData.total);
        }
      });
    });  });
}

function clearMediaList() {
  browser.runtime.sendMessage({ action: 'clearStorage' }).then(() => loadMediaList());
}

async function addToHistory(item) {
  const result = await browser.storage.local.get('history-page');
  if (result['history-page'] !== '1' && result['history-page'] !== true) return;

  const historyResult = await browser.storage.local.get('download-history');
  let history = historyResult['download-history'] || [];
  
  // Add timestamp if not present
  item.timestamp = item.timestamp || Date.now();
  
  // Prevent duplicates (optional, but good)
  const exists = history.find(h => h.url === item.url && Math.abs(h.timestamp - item.timestamp) < 1000);
  if (!exists) {
    history.unshift(item);
    // Limit history to 100 items
    if (history.length > 100) history = history.slice(0, 100);
    await browser.storage.local.set({ 'download-history': history });
  }
}

async function loadHistoryList() {
  const historyContainer = document.getElementById('history-list');
  const historyResult = await browser.storage.local.get('download-history');
  const history = historyResult['download-history'] || [];

  historyContainer.innerHTML = '';

  if (history.length === 0) {
    historyContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; opacity: 0.8; line-height: 1.6;">${browser.i18n.getMessage("noHistory") || "No download history found."}</div>`;
    return;
  }

  history.forEach((item, index) => {
    const historyItem = document.createElement('mdui-list-item');
    historyItem.setAttribute('nonclickable', 'true');
    
    const iconContainer = document.createElement('mdui-icon');
    iconContainer.setAttribute('slot', 'icon');
    iconContainer.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>`;
    historyItem.appendChild(iconContainer);

    const headline = document.createElement('div');
    headline.setAttribute('slot', 'headline');
    headline.textContent = item.filename || getFileName(item.url);
    historyItem.appendChild(headline);

    const description = document.createElement('div');
    description.setAttribute('slot', 'description');
    const dateStr = new Date(item.timestamp).toLocaleString();
    description.textContent = dateStr;
    historyItem.appendChild(description);

    const endIconArea = document.createElement('div');
    endIconArea.setAttribute('slot', 'end-icon');
    endIconArea.style.display = 'flex';
    endIconArea.style.gap = '4px';

    const linkBtn = document.createElement('mdui-button-icon');
    linkBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></mdui-icon>`;
    linkBtn.title = "Copy URL";
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(item.url).then(() => {
        if (typeof mdui !== 'undefined' && mdui.snackbar) {
          mdui.snackbar({ message: browser.i18n.getMessage("copyURLSuccess") || "URL copied to clipboard", placement: "top" });
        }
      });
    });

    const deleteBtn = document.createElement('mdui-button-icon');
    deleteBtn.innerHTML = `<mdui-icon><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></mdui-icon>`;
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentHistory = (await browser.storage.local.get('download-history'))['download-history'] || [];
      currentHistory.splice(index, 1);
      await browser.storage.local.set({ 'download-history': currentHistory });
      loadHistoryList();
    });

    endIconArea.appendChild(linkBtn);
    endIconArea.appendChild(deleteBtn);
    historyItem.appendChild(endIconArea);

    historyContainer.appendChild(historyItem);
  });
}

async function clearHistory() {
  await browser.storage.local.remove('download-history');
  loadHistoryList();
}

function getFileName(url, maxLength = 30) {
  try {
    let parsedUrl = new URL(url);
    let fileName = parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1).split('?')[0];
    fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if(!fileName) fileName = parsedUrl.hostname;
    if (fileName.length > maxLength) fileName = fileName.substring(0, maxLength) + '…';
    return decodeURIComponent(fileName);
  } catch (e) { return "Media File"; }
}

function getHumanReadableSize(size) {
  const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
  let sizeInBytes = parseInt(size);
  if (isNaN(sizeInBytes)) return "Unknown Size";
  let i = 0;
  while (sizeInBytes > 1024 && i < units.length - 1) { sizeInBytes /= 1024; i++; }
  return `${sizeInBytes.toFixed(2)} ${units[i]}`;
}

async function downloadFile(url, mediaDiv, specificSize) {
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}

  try {
   const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url });
   const targetRequest = requests[url]?.find(r => r.size === specificSize) || requests[url]?.[0];
   if(!targetRequest) throw new Error("Data lost");

   // Update button to Cancel
   const dlBtn = mediaDiv.querySelector('#download-button');
   if (dlBtn) {
     dlBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></mdui-icon>${browser.i18n.getMessage("cancelButton") || "Cancel"}`;
     dlBtn.classList.add('cancel-active');
   }

   // Get default filename
   const defaultName = getFileName(url, 100);
   mediaDiv.dataset.downloadId = 'dl_' + Date.now(); // Temporary ID for UI tracking
    const template = await browser.storage.local.get('filename-template').then(res => res['filename-template']);
    let finalName = defaultName;

    if (template) {
        finalName = await generateTemplateName(template, url, defaultName);
    }

    // Show Rename Dialog
    const newName = await showRenameDialog(finalName);
    if (newName === null) {
        finishDownloadUI(mediaDiv.dataset.downloadId);
        return;
    } // User cancelled

    updateDownloadingCount(1);
    const loadingBar = document.createElement('mdui-linear-progress');
    const statusInfo = document.createElement('div');
    statusInfo.className = 'download-status-info';
    statusInfo.style.fontSize = '12px';
    statusInfo.style.marginTop = '4px';
    statusInfo.style.textAlign = 'center';

    mediaDiv.dataset.url = url; // Set for progress tracking
    mediaDiv.appendChild(loadingBar);
    mediaDiv.appendChild(statusInfo);
    loadingBar.style.width = '100%';
    loadingBar.setAttribute('indeterminate', 'true');

    addToHistory({ url, filename: newName, timestamp: Date.now() });

    const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method']);
    const streamPref = await browser.storage.local.get('stream-download').then(res => res['stream-download']);
    const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');

    if (isStream && streamPref === 'offline') {
      // Redirect to dedicated stream downloader tab
      browser.tabs.create({
        url: browser.runtime.getURL(`stream_downloader.html?url=${encodeURIComponent(url)}&size=${encodeURIComponent(specificSize || '')}&filename=${encodeURIComponent(newName)}`),
        active: true
      });
      finishDownloadUI(mediaDiv.dataset.downloadId || url);
    } else if (downloadMethod === 'browser') {
      // For Native downloads, we want to ensure it doesn't just download a chunk.
      // We can try to strip range-related parameters if they exist in the URL
      let downloadUrl = url;
      try {
        const urlObj = new URL(url);
        // Common parameters used for range/offset that might limit size
        const rangeParams = ['range', 'offset', 'start', 'end'];
        let changed = false;
        rangeParams.forEach(param => {
          if (urlObj.searchParams.has(param)) {
            urlObj.searchParams.delete(param);
            changed = true;
          }
        });
        if (changed) downloadUrl = urlObj.toString();
      } catch (e) {}

      const id = await browser.downloads.download({
        url: downloadUrl,
        filename: newName,
        saveAs: false // Already showed our own dialog
      });
      mediaDiv.dataset.downloadId = id;
      // UI cleanup will be handled by background progress listener
    } else {
      // Send message to background to start download
      browser.runtime.sendMessage({
        action: 'startFetchDownload',
        url: url,
        downloadId: mediaDiv.dataset.downloadId,
        filename: newName,
        request: targetRequest
      });
      // UI updates will be handled by the message listener
    }  } catch (error) {
    showDialog("Download error: " + error.message);
    finishDownloadUI(url);
  } finally {
    if (wakeLock) wakeLock.release();
  }
}

async function generateTemplateName(template, url, originalName) {
    let result = template || "{name}";
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    const pageTitle = activeTab ? activeTab.title : "Media";
    const host = new URL(url).hostname;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    // Extract name without extension for {name}
    const lastDotIdx = originalName.lastIndexOf('.');
    const nameWithoutExt = lastDotIdx !== -1 ? originalName.substring(0, lastDotIdx) : originalName;
    const ext = lastDotIdx !== -1 ? originalName.substring(lastDotIdx) : '';

    result = result
        .replace(/{title}/g, pageTitle)
        .replace(/{host}/g, host)
        .replace(/{date}/g, dateStr)
        .replace(/{time}/g, timeStr)
        .replace(/{name}/g, nameWithoutExt);
    
    // Ensure extension is kept if not in template and not already present
    if (ext && !result.toLowerCase().endsWith(ext.toLowerCase())) {
        result += ext;
    }

    // Basic filename sanitization
    return result.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function showRenameDialog(initialValue) {
    return new Promise((resolve) => {
        const dialog = document.createElement('mdui-dialog');
        dialog.headline = browser.i18n.getMessage("renameDialogHeadline") || "Download as...";
        
        const textField = document.createElement('mdui-text-field');
        textField.value = initialValue;
        textField.style.marginTop = '16px';
        textField.setAttribute('label', browser.i18n.getMessage("renameDialogLabel") || "Filename");
        dialog.appendChild(textField);

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
            resolve(textField.value);
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


const beforeUnloadHandler = (event) => { event.preventDefault(); };
