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
    const url = chrome.runtime.getURL('offscreen.html');
    const contexts = chrome.runtime.getContexts
        ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
        : [];
    if (contexts.length) return;
    if (!chromeAudioOffscreenCreating) {
        chromeAudioOffscreenCreating = chrome.offscreen.createDocument({
            url: 'offscreen.html', reasons: ['BLOBS', 'WORKERS'],
            justification: 'Download and convert audio without opening a visible tab'
        }).finally(() => { chromeAudioOffscreenCreating = null; });
    }
    await chromeAudioOffscreenCreating;
}

async function startPersistentAudioJobDirect(message) {
    const jobId = 'audio_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const job = { ...message, action: undefined, jobId };
    chromeAudioJobs.set(jobId, { ...job, controller: null, percent: 0, isPaused: false });
    try {
        await chrome.storage.local.set({ [`audioJob_${jobId}`]: job });
        await ensureChromeAudioOffscreen();
        await chrome.runtime.sendMessage({ action: 'startOffscreenAudioJob', jobId });
        return { success: true, jobId };
    } catch (error) {
        chrome.runtime.sendMessage({ action: 'downloadError', id: job.url, url: job.url, error: error.message }).catch(() => {});
        chromeAudioJobs.delete(jobId);
        await chrome.storage.local.remove(`audioJob_${jobId}`);
        return { success: false, error: error.message };
    }
}
globalThis.startPersistentAudioJobDirect = startPersistentAudioJobDirect;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
                    const percent = total ? loaded / total * 100 : undefined;
                    chrome.runtime.sendMessage({ action: 'customStatus', id: message.url, text: total ? `Downloading ${(loaded / 1048576).toFixed(1)} MB / ${(total / 1048576).toFixed(1)} MB` : `Downloaded ${(loaded / 1048576).toFixed(1)} MB`, percent, indeterminate: !total }).catch(() => {});
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
        if (message.text) chrome.runtime.sendMessage({ action: 'customStatus', id: job.url, text: String(message.text).replace(/\s*\(?\d+(?:\.\d+)?%\)?/g, '').trim(), percent: job.percent }).catch(() => {});
    }
    if (message.action === 'audioJobComplete' && chromeAudioJobs.has(message.jobId)) {
        const job = chromeAudioJobs.get(message.jobId);
        chrome.runtime.sendMessage({ action: message.success ? 'downloadComplete' : 'downloadError', id: job.url, url: job.url, error: message.error }).catch(() => {});
        chromeAudioJobs.delete(message.jobId);
        chrome.storage.local.remove(`audioJob_${message.jobId}`);
    }
    if (message.action === 'pauseDownload' || message.action === 'resumeActiveDownload' ||
        message.action === 'pausePersistentAudioJob' || message.action === 'resumePersistentAudioJob') {
        const paused = message.action === 'pauseDownload' || message.action === 'pausePersistentAudioJob';
        const id = message.jobId || message.id;
        const job = chromeAudioJobs.get(id);
        if (job) {
            job.isPaused = paused;
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
                chromeAudioJobs.delete(id);
                chrome.storage.local.remove(`audioJob_${id}`);
            }
        }
    }
});
