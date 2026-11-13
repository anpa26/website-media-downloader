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

function formatAudioJobStatus(item) {
    const phase = item.status || 'Processing...';
    if (/^Downloading/i.test(phase) && item.total > 0 && item.loaded >= 0) {
        return `${phase} ${(item.loaded / 1048576).toFixed(1)} MB / ${(item.total / 1048576).toFixed(1)} MB`;
    }
    if (/^Downloading/i.test(phase) && item.loaded > 0) return `${phase} ${(item.loaded / 1048576).toFixed(1)} MB`;
    return phase;
}

function normalizeAudioJobStatus(text, percent) {
    if (text === undefined || text === null) return { text: undefined, percent };
    text = String(text || '');
    const matches = [...text.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*%/g)];
    if ((percent === undefined || percent === null) && matches.length) {
        percent = Number(matches[matches.length - 1][1]);
    }
    text = text
        .replace(/\s*\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)/g, '')
        .replace(/\s*\d{1,3}(?:\.\d+)?\s*%/g, '')
        .replace(/:\s*$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return { text: text || 'Processing...', percent };
}

let audioOffscreenCreating = null;
async function ensureAudioOffscreenDocument() {
    if (!browser.offscreen || !browser.offscreen.createDocument) return false;
    const offscreenUrl = browser.runtime.getURL('pages/offscreen.html');
    if (browser.runtime.getContexts) {
        const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] });
        if (contexts.length) return true;
    } else if (browser.offscreen.hasDocument && await browser.offscreen.hasDocument().catch(() => false)) {
        return true;
    }
    if (!audioOffscreenCreating) {
        audioOffscreenCreating = browser.offscreen.createDocument({
            url: 'pages/offscreen.html',
            reasons: ['BLOBS', 'WORKERS'],
            justification: 'Download and convert audio without opening a visible tab'
        }).finally(() => { audioOffscreenCreating = null; });
    }
    await audioOffscreenCreating;
    return true;
}

async function startPersistentAudioJobDirect(message) {
    const jobId = 'audio_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const job = { ...message, action: undefined, jobId, percent: 0, text: 'Starting...', status: 'running', recoveryState: 'running' };
    activeDownloads.set(jobId, { id: jobId, url: message.url, audioUrl: message.audioUrl, youtubeTracks: message.youtubeTracks, filename: message.filename, loaded: 0, total: 0, percent: 0, status: 'Starting...', mediaType: message.audioOnly ? 'audio' : 'video', isAudioJob: true });
    try {
        await browser.storage.local.set({ [`audioJob_${jobId}`]: job });
        let processor;
        if (await ensureAudioOffscreenDocument()) {
            await browser.runtime.sendMessage({ action: 'startOffscreenAudioJob', jobId });
            processor = { id: undefined, offscreen: true };
        } else {
            processor = await browser.tabs.create({ url: browser.runtime.getURL(`pages/audio_processor.html?job=${encodeURIComponent(jobId)}`), active: false });
        }
        const item = activeDownloads.get(jobId);
        if (item) {
            item.processorTabId = processor.id;
            item.isOffscreen = !!processor.offscreen;
        }
        return { success: true, jobId };
    } catch (error) {
        const item = activeDownloads.get(jobId);
        if (item) item.status = error.message;
        broadcastAudioJob({ action: 'audioJobUpdate', jobId, filename: message.filename, text: error.message, complete: true, success: false });
        activeDownloads.delete(jobId);
        await browser.storage.local.remove(`audioJob_${jobId}`).catch(() => {});
        return { success: false, error: error.message };
    }
}
