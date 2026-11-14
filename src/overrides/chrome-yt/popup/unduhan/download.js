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



const downloadFileAktif = new Set();
async function downloadFile(url, mediaDiv, specificSize, silent = false, audioUrl = null, subtitleUrl = null, customFilename = null) {
  const kunciDownload = `${url}::${audioUrl || ''}`;
  if (downloadFileAktif.has(kunciDownload)) return;
  downloadFileAktif.add(kunciDownload);
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}

  let selectedSubUrls = [];
  if (mediaDiv && mediaDiv.dataset.selectedSubtitles) {
      try {
          selectedSubUrls = JSON.parse(mediaDiv.dataset.selectedSubtitles);
      } catch (err) {
          console.error(err);
      }
  }




  let downloadId = null;
  try {
   const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url });
   let targetRequest = requests[url]?.find(r => r.size === specificSize) || requests[url]?.[0];

   if (!targetRequest && mediaDiv && mediaDiv.dataset.originalUrl) {
       const ogUrl = mediaDiv.dataset.originalUrl;
       const ogReqs = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: ogUrl });
       targetRequest = ogReqs[ogUrl]?.[0];
   }

   if (!targetRequest) {
       console.warn("Target request metadata not found, using generic fallback.");
       targetRequest = { responseHeaders: [] };
   }

   downloadId = 'dl_' + Date.now();
   if (mediaDiv) {
     const dlBtn = mediaDiv.querySelector('#download-button');
     if (dlBtn) {
       updatePausePlayUI(dlBtn, false);
       dlBtn.style.borderRadius = '';
     }
     const cancelBtn = mediaDiv.querySelector('#cancel-button');
     if (cancelBtn) cancelBtn.style.display = 'inline-flex';
     const audioBtn = mediaDiv.querySelector('#audio-only-button');
     if (audioBtn) audioBtn.style.display = 'none';
     mediaDiv.dataset.downloadId = downloadId;
     mediaDiv.dataset.downloadMode = mediaDiv.dataset.type || (audioUrl ? 'video' : 'file');
   }

   const defaultName = mediaFilename.resolve(url, targetRequest);
    const settings = await browser.storage.local.get(['filename-template', 'disable-rename-dialog']);
    const template = (settings['filename-template'] && settings['filename-template'] !== '0') ? settings['filename-template'] : '';
    const disableRename = settings['disable-rename-dialog'] === '1';
    let finalName = customFilename || defaultName;

    if (template && !customFilename) {
        finalName = await generateTemplateName(template, url, defaultName, targetRequest.pageTitle);
    }

    if (audioUrl) {
        let extMatch = url.match(/#(?:video|audio)\.([a-zA-Z0-9]+)$/);
        let ext = extMatch ? '.' + extMatch[1] : '.mp4';
        if (!finalName.toLowerCase().endsWith(ext)) finalName += ext;
    } else {
        let extMatch = url.match(/#[a-zA-Z0-9_]+\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
            let ext = '.' + extMatch[1];
            if (!finalName.toLowerCase().endsWith(ext)) {
                finalName += ext;
            }
        }
    }

    let newName = finalName;
    if (!silent) {
      if (!disableRename) {
        newName = await showRenameDialog(finalName);
        if (newName === null) {
            finishDownloadUI(downloadId);
            return;
        }


      }
    }

    updateDownloadingCount(1);
    let loadingBar = null;
    let statusInfo = null;
    let progressContainer = null;

    if (mediaDiv) {
      progressContainer = document.createElement('div');
      progressContainer.className = 'download-progress-container';

      loadingBar = document.createElement('mdui-linear-progress');
      statusInfo = document.createElement('div');
      statusInfo.className = 'download-status-info';

      progressContainer.appendChild(loadingBar);
      progressContainer.appendChild(statusInfo);
      mediaDiv.appendChild(progressContainer);
      prioritizeActiveDownload(mediaDiv);

      loadingBar.style.width = '100%';
      loadingBar.setAttribute('indeterminate', 'true');

      uiCache.set(downloadId, { element: mediaDiv, loadingBar, statusInfo, progressContainer });
    }

    const dlSettings = await browser.storage.local.get(['download-method', 'stream-download', 'background-download', 'mux-all-audios', 'skip-http-errors', 'embed-subtitles-mkv', 'embed-subtitles-container', 'subtitle-conversion']);
    let downloadMethod = dlSettings['download-method'] || 'browser';
    if (url.includes('#audio.m4a') || url.includes('#audio.webm')) {
        downloadMethod = 'fetch';
    }
    let streamPref = dlSettings['stream-download'] || 'offline';
    const bgDownloadEnabled = dlSettings['background-download'] !== '0';
    const skipHttpErrorsOn = dlSettings['skip-http-errors'] === '1';
    const muxAllAudios = dlSettings['mux-all-audios'] === '1';
    const embedSubtitlesMkv = dlSettings['embed-subtitles-mkv'] === '1';
    const embedSubtitlesContainer = 'mp4';

    if (await cobaDelegasiYoutube({ url, mediaDiv, audioUrl, subtitleUrl, newName, targetRequest, downloadMethod, downloadId, bgDownloadEnabled, muxAllAudios, embedSubtitlesMkv, embedSubtitlesContainer, dlSettings })) return;

    const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs[0];
    const pageUrl = activeTab ? activeTab.url : "";
    const pageTitle = activeTab ? activeTab.title : "";

    browser.runtime.sendMessage({
        action: 'addToHistory',
        item: { url, filename: newName, timestamp: Date.now(), pageUrl, pageTitle }
    });

    // Determine if subtitles should be embedded (Mediabunny) vs zipped
    const isSubtitleEmbed = embedSubtitlesMkv && subtitleUrl && subtitleUrl !== 'none';

    const isYtZipNeeded = (!isSubtitleEmbed && subtitleUrl && subtitleUrl !== 'none') || (audioUrl === 'all' && !muxAllAudios);

    if (isYtZipNeeded) {
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("zipPreparing") || "Preparing ZIP archive...";
        try {
            await ensureScriptLoaded('libraries/client-zip.js', 'downloadZip');
            await ensureScriptLoaded('libraries/subsrt.bundle.js', 'subsrt');
            const zipEntries = [];
            let videoBlob = null;
            let videoName = newName;
            const shouldDownloadVideo = true;

            if (shouldDownloadVideo) {
                if (statusInfo) statusInfo.textContent = "Downloading video stream...";
                if (audioUrl && audioUrl !== 'all') {
                    videoBlob = await downloadAndMuxYoutube(url, audioUrl, newName, downloadMethod, loadingBar, true);
                } else if (audioUrl === 'all') {
                    const ytFormats = (mediaDiv && mediaDiv.ytFormats) || [];
                    if (muxAllAudios) {
                        const uniqueAudios = kumpulkanAudioUnik(ytFormats);
                        videoBlob = await downloadAndMuxYoutube(url, uniqueAudios, newName, downloadMethod, loadingBar, true);
                    } else {
                        const formatSelect = mediaDiv ? mediaDiv.querySelector('.yt-format-select') : null;
                        const codecSelect = mediaDiv ? mediaDiv.querySelector('.yt-codec-select') : null;
                        const resSelect = mediaDiv ? mediaDiv.querySelector('.yt-resolution-select') : null;

                        const selectedDemuxer = formatSelect ? formatSelect.value : (ytFormats[0]?.demuxer || '');
                        const selectedCodec = codecSelect ? codecSelect.value : (ytFormats[0]?.codec || 'UNKNOWN');
                        const selectedRes = resSelect ? resSelect.value : (ytFormats[0]?.label || (ytFormats[0] ? `${ytFormats[0].width}x${ytFormats[0].height}` : ''));
                        const matchingFormats = ytFormats.filter(f =>
                            f.demuxer === selectedDemuxer &&
                            (f.codec === selectedCodec || (!f.codec && selectedCodec === 'UNKNOWN')) &&
                            ((f.label || `${f.width}x${f.height}`) === selectedRes)
                        );
                        const defaultFmt = matchingFormats.find(f => f.audioTrack && (f.audioTrack.audioIsDefault || f.audioTrack.audio_is_default)) || matchingFormats[0];
                        if (defaultFmt && defaultFmt.audioUrl) {
                            videoBlob = await downloadAndMuxYoutube(url, defaultFmt.audioUrl, newName, downloadMethod, loadingBar, true);
                        } else {
                            videoBlob = await fetchUrlAsBlob(url, statusInfo, "Downloading video stream");
                        }
                    }
                } else {
                    videoBlob = await fetchUrlAsBlob(url, statusInfo, "Downloading video stream");
                }
                if (videoBlob) {
                    zipEntries.push({ name: videoName, input: videoBlob });
                }
            }

            if (audioUrl === 'all' && !muxAllAudios) {
                const ytFormats = (mediaDiv && mediaDiv.ytFormats) || [];
                const uniqueAudios = kumpulkanAudioUnik(ytFormats);

                for (let i = 0; i < uniqueAudios.length; i++) {
                    const item = uniqueAudios[i];
                    if (statusInfo) statusInfo.textContent = `Downloading audio ${i+1}/${uniqueAudios.length}: ${item.name}...`;
                    try {
                        const blob = await fetchUrlAsBlob(item.url, statusInfo, `Downloading audio ${i+1}/${uniqueAudios.length}: ${item.name}`);
                        let ext = '.m4a';
                        if (item.url.includes('.webm') || item.url.includes('mime=audio%2Fwebm') || item.url.includes('mime=audio/webm')) {
                            ext = '.webm';
                        }
                        const entryName = `${newName.replace(/\.[a-zA-Z0-9]+$/, '')} - ${item.name}${ext}`;
                        zipEntries.push({ name: entryName, input: blob });
                    } catch (err) {
                        console.error("Failed to download audio track:", item.name, err);
                    }
                }
            }

            if (subtitleUrl && subtitleUrl !== 'none') {
                const ytSubtitles = (mediaDiv && mediaDiv.ytSubtitles) || [];
                const subsToDownload = [];

                if (subtitleUrl === 'all') {
                    subsToDownload.push(...ytSubtitles);
                } else {
                    const selectedSub = ytSubtitles.find(s => s.vttUrl === subtitleUrl);
                    if (selectedSub) {
                        subsToDownload.push(selectedSub);
                    } else {
                        subsToDownload.push({ vttUrl: subtitleUrl, displayName: "Subtitle", language: "und" });
                    }
                }

                const subSettings = await browser.storage.local.get(['subtitle-conversion']);
                const subFormat = subSettings['subtitle-conversion'] || 'none';
                const targetFormat = subFormat !== 'none' ? subFormat : 'vtt';

                for (let i = 0; i < subsToDownload.length; i++) {
                    const sub = subsToDownload[i];
                    if (statusInfo) statusInfo.textContent = `Downloading subtitle ${i+1}/${subsToDownload.length}: ${sub.displayName || sub.language}...`;
                    try {
                        const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: sub.vttUrl });
                        let text = bgFetch && bgFetch.text ? bgFetch.text : null;
                        if (!text) {
                            const response = await spoofedFetch(sub.vttUrl);
                            if (response.ok) text = await response.text();
                        }
                        if (text) {
                            if (targetFormat === 'srt') {
                                if (typeof window.subsrt !== 'undefined') {
                                    text = globalThis.mediaCompute?.run
                                        ? await globalThis.mediaCompute.run('subtitle-convert', { text, format: 'srt' })
                                        : window.subsrt.convert(text, { format: 'srt' });
                                } else if (text.trim().startsWith('WEBVTT')) {
                                    text = text.replace(/^WEBVTT[^\n]*\n+/i, '');
                                    text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{3})/g, '$1,$2');
                                }
                            } else if (targetFormat === 'vtt') {
                                if (!text.trim().startsWith('WEBVTT')) {
                                    text = "WEBVTT\n\n" + text.trim();
                                    text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/g, '$1.$2');
                                }
                            }
                            const subName = `${newName.replace(/\.[a-zA-Z0-9]+$/, '')} - ${sub.displayName || sub.language}.${targetFormat}`;
                            zipEntries.push({ name: subName, input: text });
                        }
                    } catch (err) {
                        console.error("Failed to fetch subtitle:", sub.displayName, err);
                    }
                }
            }

            if (zipEntries.length === 0) throw new Error("No files downloaded.");

            if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("zipGenerating") || "Generating ZIP archive...";
            const zipBlob = globalThis.mediaCompute?.createZip
                ? await globalThis.mediaCompute.createZip(zipEntries)
                : await downloadZip(zipEntries).blob();
            const zipName = `${newName.replace(/\.[a-zA-Z0-9]+$/, '')}.zip`;

            if (typeof finalizeDownload === 'function') {
                await finalizeDownload(zipBlob, zipName, downloadMethod, loadingBar, false, false);
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
                }, 2000);
            }

            finishDownloadUI(downloadId, true);
        } catch (e) {
            console.error("ZIP creation failed:", e);
            if (typeof showDialog === 'function') showDialog("Failed to create ZIP: " + e.message);
            finishDownloadUI(downloadId, false);
        }
        return;
    }

    const nonYtSettings = await browser.storage.local.get(['embed-subtitles-nonyt']);
    const embedSubtitlesNonYt = nonYtSettings['embed-subtitles-nonyt'] === '1';
    const isNonYtSubtitleEmbed = embedSubtitlesNonYt && selectedSubUrls.length > 0 && !url.toLowerCase().includes('.m3u8') && !url.toLowerCase().includes('.mpd');

    if (isNonYtSubtitleEmbed) {
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("startingDownload") || "Starting download...";
        try {
            if (statusInfo) statusInfo.textContent = "Downloading video...";
            const videoBlob = await fetchUrlAsBlob(url, statusInfo, "Downloading video");
            if (!videoBlob) throw new Error("Failed to download video file.");

            if (statusInfo) statusInfo.textContent = "Fetching subtitles...";
            const subData = [];
            for (let i = 0; i < selectedSubUrls.length; i++) {
                const subUrl = selectedSubUrls[i];
                if (statusInfo) statusInfo.textContent = `Fetching subtitle ${i+1}/${selectedSubUrls.length}...`;
                try {
                    const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: subUrl });
                    let text = bgFetch && bgFetch.text ? bgFetch.text : null;
                    if (!text) {
                        const resp = await spoofedFetch(subUrl);
                        if (resp.ok) text = await resp.text();
                    }
                    if (text) {
                        const cleaned = cleanVtt(text);
                        const matchedReq = allMediaRequests.find(r => (r.bestRequest.originalUrl === subUrl || r.bestRequest.url === subUrl));
                        const name = matchedReq ? (matchedReq.resolvedFilename || getFileName(subUrl)) : getFileName(subUrl);
                        let lang = 'und';
                        const langMatch = name.match(/[\s._-]([a-z]{2})[\s._-]/i) || name.match(/^([a-z]{2})[\s._-]/i);
                        if (langMatch) lang = langMatch[1].toLowerCase();

                        if (cleaned) subData.push({ text: cleaned, language: lang, displayName: name.replace(/\.[a-zA-Z0-9]+$/, '') });
                    }
                } catch (err) {
                    console.error('Failed to fetch subtitle:', subUrl, err);
                }
            }

            if (statusInfo) statusInfo.textContent = 'Embedding subtitles with LibAV...';
            await embedSubtitlesWithLibAV(videoBlob, subData, embedSubtitlesContainer, newName, downloadMethod, loadingBar);
            finishDownloadUI(downloadId, true);
        } catch (e) {
            console.error("Non-YT subtitle embedding failed:", e);
            if (e.message !== "Cancelled") showDialog(browser.i18n.getMessage("downloadError", [e.message]));
            finishDownloadUI(downloadId, false);
        }
        return;
    }

    const subSettings = await browser.storage.local.get(['subtitle-conversion']);
    const subFormat = subSettings['subtitle-conversion'] || 'none';
    const mediaType = getMediaType(url, targetRequest.responseHeaders);
    if (mediaType === 'subtitle' && subFormat !== 'none') {
        try {
            let text;
            const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: url });
            if (bgFetch && bgFetch.text) {
                text = bgFetch.text;
            } else {
                const response = await spoofedFetch(url);
                if (!response.ok) throw new Error("Fetch failed");
                text = await response.text();
            }

            try {
                if (typeof window.subsrt !== 'undefined') {
                    text = globalThis.mediaCompute?.run
                        ? await globalThis.mediaCompute.run('subtitle-convert', { text, format: subFormat })
                        : window.subsrt.convert(text, { format: subFormat });
                } else {
                    throw new Error("subsrt not loaded");
                }
            } catch (convErr) {
                console.warn("subsrt conversion failed, using fallback:", convErr);
                if (subFormat === 'srt') {
                    if (text.trim().startsWith('WEBVTT')) {
                        text = text.replace(/^WEBVTT[^\n]*\n+/i, '');
                        text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{3})/g, '$1,$2');
                    }
                } else if (subFormat === 'vtt') {
                    if (!text.trim().startsWith('WEBVTT')) {
                        text = "WEBVTT\n\n" + text.trim();
                        text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/g, '$1.$2');
                    }
                }
            }

            newName = newName.replace(/\.[a-z0-9]+$/i, '.' + subFormat);
            if (!newName.toLowerCase().endsWith('.' + subFormat)) newName += '.' + subFormat;

            let mimeType = 'application/octet-stream';
            if (subFormat === 'srt') mimeType = 'application/x-subrip';
            if (subFormat === 'vtt') mimeType = 'text/vtt';
            const blobUrl = URL.createObjectURL(new Blob([text], {type: mimeType}));
            if (typeof finalizeDownload === 'function') {
                const blob = new Blob([text], {type: mimeType});
                await finalizeDownload(blob, newName, downloadMethod, loadingBar, false, false);
            } else {
                if (downloadMethod === 'browser') {
                    const id = await browser.downloads.download({ url: blobUrl, filename: newName, saveAs: false });
                    if (mediaDiv) mediaDiv.dataset.downloadId = id;
                } else {
                    const a = document.createElement("a");
                    a.href = blobUrl;
                    a.download = newName;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => document.body.removeChild(a), 1000);
                }
                setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            }
            finishDownloadUI(downloadId, true);
            return;
        } catch (e) {
            console.error("Subtitle conversion failed", e);
        }
    }

    if (!bgDownloadEnabled) {
        if (streamPref === 'offline') streamPref = 'stream';
    }

    const isStream = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');
    const cloudSettings = await browser.storage.local.get(['save-to-gdrive', 'save-to-dropbox']);
    const cloudEnabled = cloudSettings['save-to-gdrive'] === '1' || cloudSettings['save-to-dropbox'] === '1';

    if (audioUrl) {
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("startingDownload") || "Starting download...";
        try {
            console.log("downloadFile: Calling downloadAndMuxYoutube...");

            let targetAudio = audioUrl;
            if (audioUrl === 'all' && muxAllAudios) {
                const ytFormats = (mediaDiv && mediaDiv.ytFormats) || [];
                const uniqueAudios = kumpulkanAudioUnik(ytFormats);
                targetAudio = uniqueAudios;
            }

            if (window.activeCancellations) {
                window.activeCancellations.delete(url);
                if (Array.isArray(targetAudio)) {
                    targetAudio.forEach(item => window.activeCancellations.delete(item.url));
                } else {
                    window.activeCancellations.delete(targetAudio);
                }
            }
            if (isSubtitleEmbed) {
                const supportsInlineSubtitles = downloadAndMuxYoutube.supportsInlineSubtitles === true;
                let muxedBlob = null;
                if (!supportsInlineSubtitles) {
                    console.log("downloadFile: isSubtitleEmbed is active. Muxing to temp blob...");
                    if (statusInfo) statusInfo.textContent = "Downloading and muxing video+audio...";
                    muxedBlob = await downloadAndMuxYoutube(url, targetAudio, newName, downloadMethod, loadingBar, true);
                }

                if (statusInfo) statusInfo.textContent = "Fetching subtitles...";

                // Get all subtitles to embed
                const ytSubtitles = (mediaDiv && mediaDiv.ytSubtitles) || [];
                const subsToEmbed = [];
                if (subtitleUrl === 'all') {
                    subsToEmbed.push(...ytSubtitles);
                } else {
                    const selectedSub = ytSubtitles.find(s => s.vttUrl === subtitleUrl);
                    subsToEmbed.push(selectedSub || { vttUrl: subtitleUrl, displayName: 'Subtitle', language: 'und' });
                }

                // Helper: convert 2-letter lang code to 3-letter ISO 639-2/T

                // Helper: clean YouTube VTT — removes duplicate word-by-word cues, sorts strictly

                // Download all subtitle texts first
                const subData = [];
                for (let i = 0; i < subsToEmbed.length; i++) {
                    const sub = subsToEmbed[i];
                    if (statusInfo) statusInfo.textContent = `Fetching subtitle ${i+1}/${subsToEmbed.length}: ${sub.displayName || sub.language}...`;
                    try {
                        const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: sub.vttUrl });
                        let text = bgFetch && bgFetch.text ? bgFetch.text : null;
                        if (!text) {
                            const resp = await spoofedFetch(sub.vttUrl);
                            if (resp.ok) text = await resp.text();
                        }
                        if (text) {
                            const cleaned = cleanVtt(text);
                            if (cleaned) subData.push({ text: cleaned, language: sub.language, displayName: sub.displayName });
                        }
                    } catch (err) {
                        console.error('Failed to fetch subtitle:', sub.displayName, err);
                    }
                }


                if (supportsInlineSubtitles) {
                    await downloadAndMuxYoutube(url, targetAudio, newName, downloadMethod, loadingBar, false, subData);
                } else {
                    if (statusInfo) statusInfo.textContent = 'Embedding subtitles with LibAV...';
                    await embedSubtitlesWithLibAV(muxedBlob, subData, embedSubtitlesContainer, newName, downloadMethod, loadingBar);
                }
            } else {
                await downloadAndMuxYoutube(url, targetAudio, newName, downloadMethod, loadingBar);
            }
            console.log("downloadFile: downloadAndMuxYoutube finished successfully.");
            finishDownloadUI(downloadId, true);
            if (subtitleUrl && !isSubtitleEmbed) {
                let subExt = '.vtt';
                if (subtitleUrl.toLowerCase().includes('fmt=srt') || subtitleUrl.toLowerCase().includes('.srt')) {
                    subExt = '.srt';
                }
                const subSettings = await browser.storage.local.get(['subtitle-conversion']);
                const subFormat = subSettings['subtitle-conversion'] || 'none';
                if (subFormat !== 'none') {
                    subExt = '.' + subFormat;
                }
                const subName = newName.replace(/\.[a-zA-Z0-9]+$/, '') + subExt;
                downloadFile(subtitleUrl, null, 'unknown', false, null, null, subName);
            }
        } catch (e) {
            console.error("downloadFile: Muxing failed", e);
            if (e.message !== "Cancelled") showDialog(browser.i18n.getMessage("downloadError", [e.message]));
            finishDownloadUI(downloadId, false);
        }
        return;
    }

    if (isStream && !bgDownloadEnabled) {
      const selectedRes = mediaDiv ? mediaDiv.dataset.selectedResolution : '';
      if (selectedRes && mediaDiv) mediaDiv.dataset.selectedResolution = selectedRes;
      loadingBar.max = 100;
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo.textContent = browser.i18n.getMessage('preparingManifest') || 'Preparing stream...';
      let subDataStream = null;
      const pengaturanSubStream = await browser.storage.local.get(['embed-subtitles-nonyt']);
      if (pengaturanSubStream['embed-subtitles-nonyt'] === '1' && selectedSubUrls.length > 0) {
        subDataStream = [];
        for (let i = 0; i < selectedSubUrls.length; i++) {
          const subUrl = selectedSubUrls[i];
          try {
            const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: subUrl });
            let text = bgFetch && bgFetch.text ? bgFetch.text : null;
            if (!text) {
              const resp = await spoofedFetch(subUrl);
              if (resp.ok) text = await resp.text();
            }
            if (text) {
              const cleaned = cleanVtt(text);
              const matchedReq = allMediaRequests.find(r => (r.bestRequest.originalUrl === subUrl || r.bestRequest.url === subUrl));
              const name = matchedReq ? (matchedReq.resolvedFilename || getFileName(subUrl)) : getFileName(subUrl);
              let lang = 'und';
              const langMatch = name.match(/[\s._-]([a-z]{2})[\s._-]/i) || name.match(/^([a-z]{2})[\s._-]/i);
              if (langMatch) lang = langMatch[1].toLowerCase();
              if (cleaned) subDataStream.push({ text: cleaned, language: lang, displayName: name.replace(/\.[a-zA-Z0-9]+$/, '') });
            }
          } catch (err) {
            console.error('Failed to fetch subtitle:', subUrl, err);
          }
        }
        if (!subDataStream.length) subDataStream = null;
      }
      const result = url.toLowerCase().includes('.mpd')
        ? await downloadMPDOffline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, false, selectedRes, subDataStream)
        : await downloadM3U8Offline(url, targetRequest.responseHeaders, downloadMethod, loadingBar, targetRequest, newName, false, selectedRes, subDataStream);
      if (window.activeCancellations.has(url)) throw new Error('Cancelled');
      finishDownloadUI(downloadId, true);
      return result;
    } else if (isStream && streamPref === 'offline') {
      const selectedRes = mediaDiv ? mediaDiv.dataset.selectedResolution : '';
      loadingBar.max = 100;
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo.textContent = browser.i18n.getMessage('preparingManifest') || 'Preparing stream...';
      let subDataStream = null;
      const pengaturanSubStream = await browser.storage.local.get(['embed-subtitles-nonyt']);
      if (pengaturanSubStream['embed-subtitles-nonyt'] === '1' && selectedSubUrls.length > 0) {
        subDataStream = [];
        for (let i = 0; i < selectedSubUrls.length; i++) {
          const subUrl = selectedSubUrls[i];
          try {
            const bgFetch = await browser.runtime.sendMessage({ action: 'fetchText', url: subUrl });
            let text = bgFetch && bgFetch.text ? bgFetch.text : null;
            if (!text) {
              const resp = await spoofedFetch(subUrl);
              if (resp.ok) text = await resp.text();
            }
            if (text) {
              const cleaned = cleanVtt(text);
              const matchedReq = allMediaRequests.find(r => (r.bestRequest.originalUrl === subUrl || r.bestRequest.url === subUrl));
              const name = matchedReq ? (matchedReq.resolvedFilename || getFileName(subUrl)) : getFileName(subUrl);
              let lang = 'und';
              const langMatch = name.match(/[\s._-]([a-z]{2})[\s._-]/i) || name.match(/^([a-z]{2})[\s._-]/i);
              if (langMatch) lang = langMatch[1].toLowerCase();
              if (cleaned) subDataStream.push({ text: cleaned, language: lang, displayName: name.replace(/\.[a-zA-Z0-9]+$/, '') });
            }
          } catch (err) {
            console.error('Failed to fetch subtitle:', subUrl, err);
          }
        }
        if (!subDataStream.length) subDataStream = null;
      }
      const streamJob = await browser.runtime.sendMessage({
        action: 'startPersistentStreamJob', url, filename: newName,
        quality: selectedRes || 'highest', request: targetRequest, downloadMethod, subData: subDataStream
      });
      if (!streamJob?.success) throw new Error(streamJob?.error || 'Unable to start stream download');
      if (streamJob.jobId && mediaDiv) {
        mediaDiv.dataset.downloadId = streamJob.jobId;
        const itemTersimpen = uiCache.get(downloadId) || uiCache.get(url);
        if (itemTersimpen) uiCache.set(streamJob.jobId, itemTersimpen);
      }
      return;
    } else if (bgDownloadEnabled && downloadMethod === 'browser' && !cloudEnabled && !skipHttpErrorsOn) {

      let downloadUrl = url;
      try {
        const urlObj = new URL(url);
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

      if (downloadMethod === 'browser') {
        const id = await browser.downloads.download({
          url: downloadUrl,
          filename: newName,
          saveAs: false
        });
        if (mediaDiv) mediaDiv.dataset.downloadId = id;
      } else {

        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = newName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          finishDownloadUI(downloadId, true);
        }, 1000);
      }
    } else {

      if (!bgDownloadEnabled) {

        let showNotif = false;
        let notifId = '';
        try {
          const showNotifRes = await browser.storage.local.get('fetch-notification');
          showNotif = showNotifRes['fetch-notification'] !== '0';
          notifId = 'fetch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

          if (showNotif) {
            try {
              browser.notifications.create(notifId, {
                type: "basic",
                iconUrl: browser.runtime.getURL("icons/icon.png"),
                title: (browser.i18n.getMessage("downloadingTitle") || "Downloading..."),
                message: newName
              });
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }

          const response = await spoofedFetch(url);

          if (!response.ok) {
            if (await shouldSkipHttpError(response.status)) { handleSkippedHttpError(url, response.status); return; }
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const contentLength = +(response.headers.get('Content-Length') || 0);

          const reader = response.body.getReader();
          let receivedLength = 0;
          let chunks = [];

          loadingBar.removeAttribute('indeterminate');
          if (contentLength > 0) loadingBar.max = contentLength;

          while(true) {
            while (window.activePauses && (window.activePauses.has(url) || (mediaDiv?.dataset?.downloadId && window.activePauses.has(mediaDiv.dataset.downloadId)))) { await new Promise(r => setTimeout(r, 200)); }
            if (window.activeCancellations.has(url)) {
              reader.cancel();
              throw new Error("Cancelled");
            }
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;

            if (contentLength > 0) {
              loadingBar.value = receivedLength;
              const percent = Math.round((receivedLength / contentLength) * 100);
              const loadedMB = (receivedLength / 1048576).toFixed(1);
              const totalMB = (contentLength / 1048576).toFixed(1);
              statusInfo.textContent = browser.i18n.getMessage("downloadPopupProgressWithSize", [percent.toString(), loadedMB, totalMB]);
            } else {
              const loadedMB = (receivedLength / 1048576).toFixed(1);
              statusInfo.textContent = browser.i18n.getMessage("downloadPopupProgressNoSize", [loadedMB]);
            }
          }

          const blob = new Blob(chunks);

          const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method'] || 'browser');
          await finalizeDownload(blob, newName, downloadMethod, loadingBar, false, false);

          if (showNotif) {
            try {
              browser.notifications.clear(notifId);
              const completeId = notifId + '_complete';
              browser.notifications.create(completeId, {
                type: "basic",
                iconUrl: browser.runtime.getURL("icons/icon.png"),
                title: browser.i18n.getMessage("downloadCompleteTitle") || "Download completed",
                message: newName
              });
              setTimeout(() => {
                try { browser.notifications.clear(completeId); } catch (e) {}
              }, 5000);
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }

          finishDownloadUI(downloadId, true);
        } catch (e) {
          console.error("Popup fetch error:", e);
          if (showNotif && notifId) {
            try {
              browser.notifications.clear(notifId);
              if (e.message !== "Cancelled") {
                browser.notifications.create(notifId + '_error', {
                  type: "basic",
                  iconUrl: browser.runtime.getURL("icons/icon.png"),
                  title: "Download failed",
                  message: e.message
                });
              }
            } catch (err) {
              console.warn("Notifications API error:", err);
            }
          }
          if (e.message !== "Cancelled") showDialog(browser.i18n.getMessage("downloadError", [e.message]));
          finishDownloadUI(downloadId);
        }
      } else {

        browser.runtime.sendMessage({
          action: 'startFetchDownload',
          url: url,
          downloadId: mediaDiv ? mediaDiv.dataset.downloadId : downloadId,
          filename: newName,
          request: targetRequest,
          mediaType: mediaDiv ? mediaDiv.dataset.type : getMediaType(url, targetRequest.responseHeaders)
        });
      }
    }  } catch (error) {
    let errMsg = error.message;
    if (error.message && error.message.includes("Extension context invalidated")) {
        errMsg = "Extension context invalidated. Please reload the page to continue using the downloader.";
    }
    try {
        showDialog(browser.i18n.getMessage("downloadError", [errMsg]) || errMsg);
    } catch (e) {
        showDialog(errMsg);
    }
    if (downloadId) finishDownloadUI(downloadId);
  } finally {
    if (window.activeCancellations) {
        window.activeCancellations.delete(url);
        if (audioUrl) window.activeCancellations.delete(audioUrl);
        if (downloadId) window.activeCancellations.delete(downloadId);

        const restoreCb = window.activeCancellations.restoreCallbacks.get(url);
        if (restoreCb) restoreCb();
        window.activeCancellations.restoreCallbacks.delete(url);
    }
    if (wakeLock) wakeLock.release();
    downloadFileAktif.delete(kunciDownload);
  }
}
