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


const autoDownloadedMedia = new Set();
const autoStreamPages = new Map();
const AUTO_STREAM_PRIORITY_MS = 2500;
const AUTO_STREAM_DEDUPE_MS = 30000;

function normalizeAutoDownloadDomain(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, ''); }
    catch (_) { return raw.split('/')[0].split(':')[0].replace(/^www\./, ''); }
}

async function maybeAutoDownloadMedia(details, settings, requestItem = null) {
    if (!settings.autoDownloadMedia || !settings.backgroundDownload || details.tabId < 0 || tabsWithDrm.has(details.tabId)) return;
    const responseHeaders = details.responseHeaders || requestItem?.responseHeaders || [];
    const contentType = responseHeaders.find(h => h.name?.toLowerCase() === 'content-type')?.value || '';
    const mediaType = getMediaType(details.url, contentType);
    if (!mediaType || !['video', 'stream'].includes(mediaType)) return;
    if (!settings[`autoDownload${mediaType[0].toUpperCase()}${mediaType.slice(1)}`]) return;

    let pageUrl = requestItem?.pageUrl || details.pageUrl || tabMetadata.get(details.tabId)?.url || '';
    let pageTitle = requestItem?.pageTitle || details.pageTitle || tabMetadata.get(details.tabId)?.title || '';
    if (!pageUrl) {
        try { const tab = await browser.tabs.get(details.tabId); pageUrl = tab?.url || ''; pageTitle = tab?.title || pageTitle; } catch (_) {}
    }
    if (pageUrl.startsWith('chrome-extension://') || pageUrl.startsWith('moz-extension://')) return;
    let pageHost = '';
    try { pageHost = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return; }
    let mediaHost = '';
    try { mediaHost = new URL(details.url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) {}
    const isYoutubeHost = host => ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
    if (requestItem?.ytFormats?.length || requestItem?.autoYoutubeAudioOnly || isYoutubeHost(pageHost) || isYoutubeHost(mediaHost)) return;
    const domains = String(settings.autoDownloadDomains || '').split(/[\n,]+/).map(normalizeAutoDownloadDomain).filter(Boolean);
    if (!settings.autoDownloadAllDomains && !domains.some(domain => pageHost === domain || pageHost.endsWith(`.${domain}`))) return;
    if (settings.autoIgnoreExcludedMedia) {
        const skippedNames = String(settings.autoSkipDownloadNames || '').split(/[\n,]+/).map(value => value.trim().toLowerCase()).filter(Boolean);
        let decodedUrl = details.url.toLowerCase();
        try { decodedUrl = decodeURIComponent(decodedUrl); } catch (_) {}
        const filenameCandidate = getFileName(details.url).toLowerCase();
        const candidateText = settings.autoSkipDownloadNamesOnly ? filenameCandidate : `${decodedUrl}\n${pageTitle.toLowerCase()}\n${filenameCandidate}`;
        if (skippedNames.some(value => candidateText.includes(value))) return;

        let mediaHost = '';
        try { mediaHost = new URL(details.url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) {}
        const skippedDomains = String(settings.autoSkipDownloadDomains || '').split(/[\n,]+/).map(normalizeAutoDownloadDomain).filter(Boolean);
        if (skippedDomains.some(domain => pageHost === domain || pageHost.endsWith(`.${domain}`) || mediaHost === domain || mediaHost.endsWith(`.${domain}`))) return;
    }

    const pageMediaKey = `${details.tabId}|${pageUrl.split("#")[0]}`;
    if (mediaType === "stream") {
        const detectedAt = Date.now();
        autoStreamPages.set(pageMediaKey, detectedAt);
        setTimeout(() => {
            if (autoStreamPages.get(pageMediaKey) === detectedAt) autoStreamPages.delete(pageMediaKey);
        }, AUTO_STREAM_DEDUPE_MS);
    } else if (mediaType === "video") {
        await new Promise(resolve => setTimeout(resolve, AUTO_STREAM_PRIORITY_MS));
        if (autoStreamPages.has(pageMediaKey)) return;
    }

    const key = mediaType === "stream" ? `${pageHost}|${details.url.split("#")[0]}` : `${pageHost}|${details.url.split("?")[0].split("#")[0]}`;
    if (autoDownloadedMedia.has(key)) return;
    autoDownloadedMedia.add(key);

    try {
        const stored = await browser.storage.local.get(['download-method', 'stream-download']);
        let filename = await getAutomaticFilename(details.url, details.tabId, { ...(requestItem || {}), ...details, pageTitle });
        if (settings.filenameTemplate) filename = await generateTemplateName(settings.filenameTemplate, details.url, filename, details.tabId);
        if (mediaType === 'stream') {
            if (!filename.toLowerCase().endsWith('.mp4')) filename = filename.replace(/\.[^.]+$/, '') + '.mp4';
            await addToHistory({ url: details.url, filename, timestamp: Date.now(), pageUrl, pageTitle, mediaType });
            const streamType = contentType.toLowerCase().includes('dash+xml') || /\.mpd(?:[?#]|$)/i.test(details.url) ? 'dash' : 'hls';
            const started = await globalThis.startPersistentStreamJobDirect({ action: 'startPersistentStreamJob', url: details.url, filename, quality: settings.autoDownloadQuality || 'highest', streamType, request: requestItem || {}, downloadMethod: stored['download-method'] || 'fetch' });
            if (!started.success) throw new Error(started.error || 'Unable to start stream download');
        } else {
            await addToHistory({ url: details.url, filename, timestamp: Date.now(), pageUrl, pageTitle, mediaType });
            if ((stored['download-method'] || 'fetch') === 'fetch') handleFetchDownload(details.url, filename, requestItem, null, false, false, null, mediaType);
            else await browser.downloads.download({ url: details.url, filename: sanitizeFilename(filename), saveAs: false });
        }
    } catch (error) {
        autoDownloadedMedia.delete(key);
        console.error('Auto-download failed:', error);
    }
}

const AUTO_DOWNLOAD_RESCAN_KEYS = new Set([
    'auto-download-media', 'auto-download-quality',
    'auto-download-all-domains', 'auto-download-domains', 'auto-skip-download-names-only', 'auto-download-video', 'auto-download-stream'
]);
let autoDownloadRescanTimer = null;

function scheduleExistingMediaAutoDownload(settings) {
    if (!settings.autoDownloadMedia || !settings.backgroundDownload) return;
    clearTimeout(autoDownloadRescanTimer);
    autoDownloadRescanTimer = setTimeout(async () => {
        const items = await browser.storage.session.get(null);
        for (const [url, requests] of Object.entries(items || {})) {
            if (!Array.isArray(requests) || requests.length === 0) continue;
            const request = requests[requests.length - 1];
            const tabId = Number.isInteger(request.tabId) ? request.tabId : -1;
            if (tabId < 0) continue;
            maybeAutoDownloadMedia({
                url, tabId, pageUrl: request.pageUrl, pageTitle: request.pageTitle,
                responseHeaders: request.responseHeaders || []
            }, settings, request);
        }
    }, 150);
}

async function showMediaNotification(details, settings) {
    if (await detectionExclusions.shouldSkip(details, true)) return;
    if (!settings.mediaNotification) return;

    const url = details.url;
    const tabId = details.tabId;
    if (tabId < 0) return;



    const sessionData = await new Promise(resolve => {
        browser.storage.session.get(url, (res) => resolve(res[url] || []));
    });
    const requestItem = sessionData.length > 0 ? sessionData[sessionData.length - 1] : null;
    let hlsFormats = null;

    if (!hlsFormats && url.toLowerCase().includes('.m3u8')) {
        try {
            const hlsVariants = await getM3U8VariantsBg(url);
            if (hlsVariants && hlsVariants.length > 0) {
                hlsFormats = hlsVariants.map(v => ({
                    resolution: v.resolution,
                    bandwidth: v.bandwidth,
                    videoUrl: url,
                    variantUrl: v.uri,
                    demuxer: 'm3u8'
                }));
            }
        } catch (e) {
            console.warn("Failed to get HLS variants for notification:", e);
        }
    }

    const baseUrl = url.split('?')[0].split('#')[0];

    if (!notifiedUrls.has(tabId)) notifiedUrls.set(tabId, new Set());
    const tabNotified = notifiedUrls.get(tabId);
    if (tabNotified.has(baseUrl)) return;

    const responseHeaders = details.responseHeaders || [];
    let contentType = responseHeaders.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
    let contentLength = parseInt(responseHeaders.find(h => h.name.toLowerCase() === 'content-length')?.value || '0');

    const mediaType = getMediaType(url, contentType);
    const isVideo = mediaType === 'video';
    const isAudio = mediaType === 'audio';
    const isImage = mediaType === 'image';
    const isStream = mediaType === 'stream';
    const isSubtitle = mediaType === 'subtitle';

    if (isVideo && !settings.onlyVideo) return;
    if (isAudio && !settings.onlyAudio) return;
    if (isStream && !settings.onlyStream) return;
    if (isImage && !settings.onlyImage) return;
    if (isSubtitle && !settings.onlySubtitle) return;
    if (isMediaTypeDisabled(mediaType, settings)) return;

    if (!mediaType) return;

    if (!details.isYtNotification && checkIsSegment(url, contentType, contentLength, settings)) return;

    const now = Date.now();

    if (lastNotificationTime.has(tabId) && (now - lastNotificationTime.get(tabId) < 2000)) {
        return;
    }

    let displayFilename = getFileName(url, 180);
    try {
        displayFilename = await getAutomaticFilename(url, tabId, {
            ...(requestItem || {}),
            ...details,
            pageTitle: requestItem?.pageTitle || details.pageTitle,
            responseHeaders: details.responseHeaders || requestItem?.responseHeaders
        });
    } catch (error) {
        console.warn('Notification filename fallback:', error);
    }
    if (settings.filenameTemplate && settings.filenameTemplate !== '0') {
        try {
            displayFilename = await generateTemplateName(settings.filenameTemplate, url, displayFilename, tabId);
        } catch (error) {
            console.warn('Notification filename template fallback:', error);
        }
    }

    const notificationTime = Date.now();
    if (tabNotified.has(baseUrl) ||
        (lastNotificationTime.has(tabId) && notificationTime - lastNotificationTime.get(tabId) < 2000)) return;
    tabNotified.add(baseUrl);
    lastNotificationTime.set(tabId, notificationTime);

    let pageUrl = "";
    try {
        const tab = await browser.tabs.get(tabId);
        if (tab) pageUrl = tab.url;
    } catch (e) {}

    if (pageUrl) {
        autoUpdateHistoryLink(pageUrl, displayFilename, url, tabId);
    }

    const isDrm = tabsWithDrm.has(tabId);
    const drmMsg = browser.i18n.getMessage("mediaNotificationDrmMessage") || "DRM Protected";

    const finalDisplayFilename = isDrm ? drmMsg : displayFilename;
    const notificationTitle = isDrm ? (browser.i18n.getMessage("drmWarningTitle") || "DRM Detected") : (browser.i18n.getMessage("mediaNotificationTitle") || "Media detected!");

    injectNotificationScript(tabId, finalDisplayFilename, url, mediaType, notificationTitle, settings.themeColor, isDrm, hlsFormats, settings.stackNotifications, settings.uiScale || cachedSettings.uiScale || '85%');

    const notificationButtons = isDrm ? [] : [
        { title: browser.i18n.getMessage("mediaNotificationDownloadAction") || "Download" }
    ];

    if (settings.mediaSystemNotification) {
        browser.notifications.create({
            type: "basic",
            iconUrl: browser.runtime.getURL("icons/icon.png"),
            title: notificationTitle,
            message: finalDisplayFilename,
            buttons: notificationButtons
        }, (notificationId) => {
            if (browser.runtime.lastError) {
                console.warn("Notification error (normal in some mobile browsers):", browser.runtime.lastError.message);
            }
            notificationUrls.set(notificationId, { url, tabId });
        });
    }
}

browser.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const data = notificationUrls.get(notificationId);
    if (data && buttonIndex === 0) {
        browser.storage.session.get(data.url, async (result) => {
            const requests = result[data.url];
            if (requests && requests.length > 0) {
                const request = requests[requests.length - 1];
                let pageUrl = "";
                let pageTitle = "";
                try {
                    const tab = await browser.tabs.get(data.tabId);
                    if (tab) {
                        pageUrl = tab.url;
                        pageTitle = tab.title;
                    }
                } catch (e) {}

                browser.storage.local.get(['download-method', 'filename-template', 'gdrive-stream', 'save-to-gdrive', 'gdrive_token', 'save-to-dropbox', 'dropbox-stream', 'dropbox_token'], async (res) => {
                    let method = res['download-method'] || 'browser';
                    const isGdriveStream = res['save-to-gdrive'] === '1' && res['gdrive-stream'] === '1' && res['gdrive_token'];
                    if (isGdriveStream) method = 'fetch';

                    const template = res['filename-template'];
                    const originalName = await getAutomaticFilename(data.url, data.tabId, request || {});
                    let finalName = originalName;

                    if (template) {
                        finalName = await generateTemplateName(template, data.url, originalName, data.tabId);
                    }

                    addToHistory({ url: data.url, filename: finalName, timestamp: Date.now(), pageUrl, pageTitle });

                    if (method === 'fetch') {
                        handleFetchDownload(data.url, finalName, request);
                    } else {
                        browser.downloads.download({
                            url: data.url,
                            filename: sanitizeFilename(finalName),
                            saveAs: false
                        });
                    }
                });
            }
        });
    }
    notificationUrls.delete(notificationId);
});

browser.notifications.onClicked.addListener((notificationId) => {
    const data = notificationUrls.get(notificationId);
    let popupUrl = `pages/popup.html?mode=tab`;
    if (data && data.url) {
        popupUrl += `&autoOpenUrl=${encodeURIComponent(data.url)}`;
    }
    browser.tabs.create({
        url: browser.runtime.getURL(popupUrl),
    });
    notificationUrls.delete(notificationId);
});

