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

const chromeAudioJobs = new Map();
let chromeAudioOffscreenCreating = null;

async function ensureChromeAudioOffscreen() {
    const url = chrome.runtime.getURL('pages/offscreen.html');
    const contexts = chrome.runtime.getContexts
        ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
        : [];
    if (contexts.length) return;
    if (!chromeAudioOffscreenCreating) {
        chromeAudioOffscreenCreating = chrome.offscreen.createDocument({
            url: 'pages/offscreen.html', reasons: ['BLOBS', 'WORKERS'],
            justification: 'Download and convert audio without opening a visible tab'
        }).finally(() => { chromeAudioOffscreenCreating = null; });
    }
    await chromeAudioOffscreenCreating;
}

function broadcastChromeAudioJob(message) {
    chrome.tabs.query({}).then(tabs => {
        for (const tab of tabs) {
            if (tab.id !== undefined && /^https?:/i.test(tab.url || '')) {
                chrome.tabs.sendMessage(tab.id, message).catch(() => {});
            }
        }
    }).catch(() => {});
}

async function startPersistentAudioJobDirect(message) {
    const jobId = 'audio_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const job = { ...message, action: undefined, jobId };
    chromeAudioJobs.set(jobId, { ...job, controller: null, percent: 0, isPaused: false });
    if (typeof activeDownloads !== 'undefined') {
        activeDownloads.set(jobId, {
            id: jobId, url: message.url, audioUrl: message.audioUrl,
            youtubeTracks: message.youtubeTracks, filename: message.filename,
            loaded: 0, total: 0, percent: 0, status: 'Starting...',
            mediaType: message.audioOnly ? 'audio' : 'video', isAudioJob: true
        });
    }
    try {
        await chrome.storage.local.set({ [`audioJob_${jobId}`]: job });
        await ensureChromeAudioOffscreen();
        await chrome.runtime.sendMessage({ action: 'startOffscreenAudioJob', jobId });
        return { success: true, jobId };
    } catch (error) {
        broadcastChromeAudioJob({ action: 'audioJobUpdate', jobId, filename: message.filename, text: error.message, complete: true, success: false });
        chrome.runtime.sendMessage({ action: 'downloadError', id: job.url, url: job.url, error: error.message }).catch(() => {});
        chromeAudioJobs.delete(jobId);
        if (typeof activeDownloads !== 'undefined') activeDownloads.delete(jobId);
        await chrome.storage.local.remove(`audioJob_${jobId}`);
        return { success: false, error: error.message };
    }
}
globalThis.startPersistentAudioJobDirect = startPersistentAudioJobDirect;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'wmdStorageBridge') {
        const storageLocal = (chrome && chrome.storage && chrome.storage.local) || (browser && browser.storage && browser.storage.local);
        if (!storageLocal) {
            sendResponse({ success: false, data: {} });
            return;
        }
        if (message.method === 'get') {
            storageLocal.get(message.keys).then(data => sendResponse({ success: true, data })).catch(() => sendResponse({ success: false, data: {} }));
            return true;
        }
        if (message.method === 'set') {
            storageLocal.set(message.items).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
            return true;
        }
        if (message.method === 'remove') {
            storageLocal.remove(message.keys).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
            return true;
        }
    }
    if (message.action === 'downloadOffscreenBlob') {
        const downloadsApi = (chrome && chrome.downloads) || (browser && browser.downloads);
        if (downloadsApi && downloadsApi.download) {
            downloadsApi.download({ url: message.url, filename: message.filename, saveAs: false }, (id) => {
                const err = chrome.runtime.lastError;
                if (err) sendResponse({ success: false, error: err.message });
                else sendResponse({ success: true, downloadId: id });
            });
            return true;
        }
        sendResponse({ success: false, error: 'Downloads API not available' });
        return;
    }
    if (message.action === 'startPersistentAudioJob') {
        startPersistentAudioJobDirect(message).then(sendResponse);
        return true;
    }
    if (message.action === 'fetchMediaForAudio' && message.jobId) {
        const job = chromeAudioJobs.get(message.jobId);
        const controller = new AbortController();
        if (job) job.controller = controller;
        const headers = {};
        for (const header of message.request?.requestHeaders || []) {
            if (!['cookie', 'host', 'content-length', 'range'].includes(header.name.toLowerCase())) headers[header.name] = header.value;
        }
        (async () => {
            try {
                const response = await fetch(message.url, { headers, credentials: 'include', signal: controller.signal });
                if (!response.ok) throw new Error(`Server error: ${response.status}`);
                const total = Number(response.headers.get('content-length')) || 0;
                const reader = response.body.getReader();
                const chunks = [];
                let loaded = 0;
                while (true) {
                    while (job?.isPaused) await new Promise(resolve => setTimeout(resolve, 200));
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value); loaded += value.byteLength;
                    const percent = total ? Math.round(loaded / total * 100) : undefined;
                    if (typeof activeDownloads !== 'undefined') {
                        const item = activeDownloads.get(message.jobId);
                        if (item) { item.loaded = loaded; item.total = total; item.percent = percent; item.status = 'Downloading...'; }
                    }
                    broadcastChromeAudioJob({ action: 'audioJobUpdate', jobId: message.jobId, filename: job?.filename, text: 'Downloading...', percent, loaded, total, indeterminate: !total });
                    chrome.runtime.sendMessage({ action: 'customStatus', id: message.url, jobId: message.jobId, text: total ? `Downloading ${(loaded / 1048576).toFixed(1)} MB / ${(total / 1048576).toFixed(1)} MB` : `Downloaded ${(loaded / 1048576).toFixed(1)} MB`, percent, indeterminate: !total }).catch(() => {});
                }
                const bytes = new Uint8Array(loaded); let offset = 0;
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
                sendResponse({ success: true, arrayBuffer: bytes.buffer, mime: response.headers.get('content-type') || 'application/octet-stream' });
            } catch (error) { sendResponse({ success: false, error: error.message }); }
        })();
        return true;
    }
    if (message.action === 'audioJobProgress' && chromeAudioJobs.has(message.jobId)) {
        const job = chromeAudioJobs.get(message.jobId);
        if (message.percent !== undefined) job.percent = message.percent;
        const cleanText = message.text ? String(message.text).replace(/\s*\(?\d+(?:\.\d+)?%\)?/g, '').trim() : undefined;
        if (typeof activeDownloads !== 'undefined') {
            const item = activeDownloads.get(message.jobId);
            if (item) {
                if (cleanText !== undefined) item.status = cleanText;
                if (message.percent !== undefined) item.percent = message.percent;
            }
        }
        broadcastChromeAudioJob({ action: 'audioJobUpdate', jobId: message.jobId, filename: job.filename, text: cleanText || 'Processing...', percent: job.percent, indeterminate: message.indeterminate });
        if (message.text) chrome.runtime.sendMessage({ action: 'customStatus', id: job.url, jobId: message.jobId, text: cleanText, percent: job.percent, indeterminate: message.indeterminate }).catch(() => {});
    }
    if (message.action === 'audioJobComplete' && chromeAudioJobs.has(message.jobId)) {
        const job = chromeAudioJobs.get(message.jobId);
        broadcastChromeAudioJob({ action: 'audioJobUpdate', jobId: message.jobId, filename: job.filename, text: message.success ? 'Complete!' : (message.error || 'Failed'), percent: message.success ? 100 : job.percent, complete: true, success: message.success });
        chrome.runtime.sendMessage({ action: message.success ? 'downloadComplete' : 'downloadError', id: job.url, jobId: message.jobId, url: job.url, error: message.error }).catch(() => {});
        chromeAudioJobs.delete(message.jobId);
        if (typeof activeDownloads !== 'undefined') activeDownloads.delete(message.jobId);
        chrome.storage.local.remove(`audioJob_${message.jobId}`);
    }
    if (message.action === 'pauseDownload' || message.action === 'resumeActiveDownload' ||
        message.action === 'pausePersistentAudioJob' || message.action === 'resumePersistentAudioJob') {
        const paused = message.action === 'pauseDownload' || message.action === 'pausePersistentAudioJob';
        const id = message.jobId || message.id;
        const job = chromeAudioJobs.get(id);
        if (job) {
            job.isPaused = paused;
            if (typeof activeDownloads !== 'undefined') {
                const item = activeDownloads.get(id);
                if (item) item.isPaused = paused;
            }
            chrome.storage.local.get(`audioJob_${id}`).then(stored => {
                if (stored[`audioJob_${id}`]) chrome.storage.local.set({ [`audioJob_${id}`]: { ...stored[`audioJob_${id}`], isPaused: paused } });
            });
            if (message.action === 'pauseDownload' || message.action === 'resumeActiveDownload') {
                chrome.runtime.sendMessage({ action: paused ? 'pausePersistentAudioJob' : 'resumePersistentAudioJob', jobId: id }).catch(() => {});
            }
            sendResponse({ success: true });
            return true;
        }
    }
    if (message.action === 'cancelDownload') {
        for (const [id, job] of chromeAudioJobs) {
            if (message.id === id || message.url === job.url) {
                job.controller?.abort();
                chrome.runtime.sendMessage({ action: 'cancelPersistentAudioJob', jobId: id, url: job.url, audioUrl: job.audioUrl, youtubeTracks: job.youtubeTracks }).catch(() => {});
                broadcastChromeAudioJob({ action: 'audioJobUpdate', jobId: id, filename: job.filename, text: 'Cancelled', percent: job.percent, complete: true, success: false });
                chrome.runtime.sendMessage({ action: 'downloadError', id: job.url, jobId: id, url: job.url, error: 'USER_CANCELED' }).catch(() => {});
                chromeAudioJobs.delete(id);
                if (typeof activeDownloads !== 'undefined') activeDownloads.delete(id);
                chrome.storage.local.remove(`audioJob_${id}`);
            }
        }
    }
});
