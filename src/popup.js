// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
  var browser = chrome;
}

let downloadingCount = 0;
let ratingCount = 0;
sessionStorage.setItem('shownYoutubeAlert', 0); 

document.addEventListener('DOMContentLoaded', () => {
  loadMediaList();
  document.getElementById('navbar').addEventListener('change', (event) => {
    const selectedTabIndex = document.getElementById('navbar').activeTabIndex;
    document.querySelectorAll('.tab-content').forEach((tabContent, index) => {
      tabContent.style.display = index === selectedTabIndex ? 'block' : 'none';
    });
  });

  document.getElementById('refresh-list').addEventListener('click', () => loadMediaList());
  document.getElementById('clear-list').addEventListener('click', () => clearMediaList());

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
    document.querySelectorAll('mdui-tab')[1].click();
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'downloadProgress') {
    updateProgressUI(message.url, message.loaded, message.total);
  } else if (message.action === 'downloadComplete') {
    finishDownloadUI(message.url);
  } else if (message.action === 'downloadError') {
    finishDownloadUI(message.url);
    showDialog("Download error: " + message.error);
  }
});

function updateProgressUI(url, loaded, total) {
  const mediaItems = document.querySelectorAll('.media-item');
  mediaItems.forEach(item => {
    // This is a bit hacky but we need to find the right item. 
    // Usually downloadFile attaches loadingBar to mediaDiv.
    // We can use a Map or data attributes to track active downloads.
    if (item.dataset.url === url) {
      const loadingBar = item.querySelector('mdui-linear-progress');
      const statusInfo = item.querySelector('.download-status-info');
      if (loadingBar && statusInfo) {
        const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
        if (total > 0) {
          const totalMB = (total / (1024 * 1024)).toFixed(2);
          const percent = Math.round((loaded / total) * 100);
          const remainingMB = ((total - loaded) / (1024 * 1024)).toFixed(2);
          statusInfo.textContent = `${loadedMB} MB / ${totalMB} MB (${percent}%) • ${remainingMB} MB remaining`;
          loadingBar.removeAttribute('indeterminate');
          loadingBar.setAttribute('max', total);
          loadingBar.setAttribute('value', loaded);
        } else {
          statusInfo.textContent = `${loadedMB} MB downloaded`;
        }
      }
    }
  });
}

function finishDownloadUI(url) {
  const mediaItems = document.querySelectorAll('.media-item');
  mediaItems.forEach(item => {
    if (item.dataset.url === url) {
      const loadingBar = item.querySelector('mdui-linear-progress');
      const statusInfo = item.querySelector('.download-status-info');
      if (loadingBar) item.removeChild(loadingBar);
      if (statusInfo) item.removeChild(statusInfo);
      updateDownloadingCount(-1);
      delete item.dataset.url;
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

function showDialog(message, title = null) {
  const dialog = document.createElement('mdui-dialog');
  const headline = document.createElement('div');
  headline.setAttribute('slot', 'headline');
  headline.textContent = title || "Notification";
  dialog.appendChild(headline);
  const description = document.createElement('div');
  description.setAttribute('slot', 'description');
  description.innerHTML = message;
  dialog.appendChild(description);
  const okButton = document.createElement('mdui-button');
  okButton.variant = "text";
  okButton.textContent = "OK";
  okButton.slot = 'action';
  okButton.addEventListener('click', () => dialog.removeAttribute('open'));
  dialog.appendChild(okButton);
  document.body.appendChild(dialog);
  dialog.setAttribute('open', true);
}

function loadMediaList() {
  const mediaContainer = document.getElementById('media-list');
  const loadingSpinner = document.getElementById('loading-media-list');
  const globalLoading = document.getElementById('loading');
  const mainContent = document.getElementById('main-content');

  if (loadingSpinner) loadingSpinner.style.display = 'block';
  mediaContainer.innerHTML = ''; 

  browser.runtime.sendMessage({ action: 'getMediaRequests' }).then(async (mediaRequests) => {
    if (globalLoading) globalLoading.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
    
    if (!mediaRequests || Object.keys(mediaRequests).length === 0) {
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        mediaContainer.innerHTML = '<div style="padding:40px; text-align:center;">No media detected.</div>';
        return;
    }

    const mediaGroups = new Map();
    for (const rawUrl in mediaRequests) {
      let mediaURL;
      try { mediaURL = new URL(rawUrl); } catch (e) { continue; }
      const requests = mediaRequests[rawUrl];
      if (!Array.isArray(requests) || requests.length === 0) continue;
      const identity = mediaURL.hostname + mediaURL.pathname;
      if (!mediaGroups.has(identity)) mediaGroups.set(identity, { requests: [] });
      const group = mediaGroups.get(identity);
      requests.forEach(req => {
        const existingIdx = group.requests.findIndex(r => r.size === req.size);
        if (existingIdx === -1) group.requests.push({ ...req, originalUrl: rawUrl });
        else if ((req.timeStamp || 0) > (group.requests[existingIdx].timeStamp || 0)) group.requests[existingIdx] = { ...req, originalUrl: rawUrl };
      });
    }

    for (const [identity, group] of mediaGroups) {
      const requests = group.requests;
      // Sort: Terbesar di urutan 0
      requests.sort((a, b) => (parseInt(b.size) || 0) - (parseInt(a.size) || 0));
      const bestRequest = requests[0]; // Ambil yang paling besar

      const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"]
      const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
      const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];

      const mediaURL = new URL(bestRequest.originalUrl);
      const mediaDiv = document.createElement('mdui-list-item');
      mediaDiv.setAttribute('nonclickable', 'true');
      mediaDiv.classList.add('media-item');
      mediaDiv.dataset.url = bestRequest.originalUrl; // Set for progress tracking

      const mediaIconContainer = document.createElement('mdui-icon');
      mediaIconContainer.setAttribute('slot', 'icon');
      mediaIconContainer.style.fontSize = '24px';
      mediaIconContainer.style.color = 'rgb(var(--mdui-color-primary))';
      const mediaIcon = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
      mediaIcon.setAttribute('viewBox', '0 -960 960 960');
      let path = document.createElementNS("http://www.w3.org/2000/svg", 'path');
      
      if (videoExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext)) || bestRequest.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && h.value.startsWith("video/"))) {
        path.setAttribute('d', 'm160-800 80 160h120l-80-160h80l80 160h120l-80-160h80l80 160h120l-80-160h120q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Zm0 240v320h640v-320H160Zm0 0v320-320Z');
      } else if (audioExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext)) || bestRequest.responseHeaders?.find(h => h.name.toLowerCase() === "content-type" && h.value.startsWith("audio/"))) {
        path.setAttribute('d', 'M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z');
      } else {
        path.setAttribute('d', 'M40-480q0-92 34.5-172T169-791.5q60-59.5 140-94T480-920q91 0 171 34.5t140 94Q851-732 885.5-652T920-480h-80q0-75-28.5-140.5T734-735q-49-49-114.5-77T480-840q-74 0-139.5 28T226-735q-49 49-77.5 114.5T120-480H40Zm160 0q0-118 82-199t198-81q116 0 198 81t82 199h-80q0-83-58.5-141.5T480-680q-83 0-141.5 58.5T280-480h-80ZM360-64l-56-56 136-136v-132q-27-12-43.5-37T380-480q0-42 29-71t71-29q42 0 71 29t29 71q0 30-16.5 55T520-388v132l136 136-56 56-120-120L360-64Z');
      }
      mediaIcon.appendChild(path);
      mediaIconContainer.appendChild(mediaIcon);
      mediaDiv.appendChild(mediaIconContainer);

      const cardContent = document.createElement('div');
      cardContent.classList.add('media-item-content');
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
      dlBtn.addEventListener('click', () => downloadFile(bestRequest.originalUrl, mediaDiv, bestRequest.size));
      
      const prvBtn = document.createElement('mdui-segmented-button');
      prvBtn.innerHTML = `<mdui-icon slot="icon"><svg viewBox="0 -960 960 960"><path d="m380-300 280-180-280-180v360ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg></mdui-icon>Preview`;
      prvBtn.addEventListener('click', () => {
          const isStream = streamExtensions.some(ext => bestRequest.originalUrl.toLowerCase().includes(ext));
          browser.tabs.create({ url: browser.runtime.getURL(`/mediaPreviewer.html?mediaUrl=${encodeURIComponent(bestRequest.originalUrl)}&isStream=${isStream}`) });
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
    endMsg.innerHTML = "End of list";
    mediaContainer.appendChild(endMsg);

    // Restore active downloads UI
    browser.runtime.sendMessage({ action: 'getActiveDownloads' }).then((activeDownloads) => {
      if (!activeDownloads) return;
      Object.keys(activeDownloads).forEach(url => {
        const item = document.querySelector(`.media-item[data-url="${url}"]`);
        if (item && !item.querySelector('mdui-linear-progress')) {
          const loadingBar = document.createElement('mdui-linear-progress');
          const statusInfo = document.createElement('div');
          statusInfo.className = 'download-status-info';
          statusInfo.style.fontSize = '12px';
          statusInfo.style.marginTop = '4px';
          statusInfo.style.textAlign = 'center';
          item.appendChild(loadingBar);
          item.appendChild(statusInfo);
          updateDownloadingCount(1);
          updateProgressUI(url, activeDownloads[url].loaded, activeDownloads[url].total);
        }
      });
    });
  });
}

function clearMediaList() {
  browser.runtime.sendMessage({ action: 'clearStorage' }).then(() => loadMediaList());
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
  updateDownloadingCount(1);
  const loadingBar = document.createElement('mdui-linear-progress');
  const statusInfo = document.createElement('div');
  statusInfo.className = 'download-status-info';
  statusInfo.style.fontSize = '12px';
  statusInfo.style.marginTop = '4px';
  statusInfo.style.textAlign = 'center';

  try {
    const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url }); 
    const targetRequest = requests[url]?.find(r => r.size === specificSize) || requests[url]?.[0];
    if(!targetRequest) throw new Error("Data lost");

    mediaDiv.dataset.url = url; // Set for progress tracking
    mediaDiv.appendChild(loadingBar);
    mediaDiv.appendChild(statusInfo);
    loadingBar.style.width = '100%';
    loadingBar.setAttribute('indeterminate', 'true');

    const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method']);
    
    if (downloadMethod === 'browser') {
      await browser.downloads.download({ url: url, filename: getFileName(url) });
      // UI cleanup will be handled by background progress listener
    } else {
      // Send message to background to start download
      browser.runtime.sendMessage({
        action: 'startFetchDownload',
        url: url,
        filename: getFileName(url)
      });
      // UI updates will be handled by the message listener
    }
  } catch (error) {
    showDialog("Download error: " + error.message);
    finishDownloadUI(url);
  } finally {
    if (wakeLock) wakeLock.release();
  }
}

const beforeUnloadHandler = (event) => { event.preventDefault(); };
