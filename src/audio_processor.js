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

if (typeof browser === 'undefined') var browser = chrome;

async function markRecoveryCompleted(key, job) {
    await browser.storage.local.set({ [key]: { ...job, recoveryState: "completed", status: "completed" } });
}

async function runPersistentAudioJob(jobId, options = {}) {
    const key = `audioJob_${jobId}`;
    const stored = await browser.storage.local.get(key);
    const job = stored[key];
    let keepRecoveryJob = false;
    if (!job) return;
    if (typeof browser.runtime.getBrowserInfo === 'function' && !options.offscreen) {
        const claim = await browser.runtime.sendMessage({ action: 'claimProcessingJob', key });
        if (!claim?.allowed) return;
    }

    const report = (text, percent, indeterminate = false) => browser.runtime.sendMessage({
        action: 'audioJobProgress', jobId, filename: job.filename, url: job.url, text, percent, indeterminate
    });
    window.activeCancellations = window.activeCancellations || new Set();
    window.activePauses = window.activePauses || new Set();
    window.activeAbortControllers = window.activeAbortControllers || new Map();
    if (job.isPaused) { window.activePauses.add(jobId); window.activePauses.add(job.url); }
    const checkCancel = () => window.activeCancellations.has(jobId) || window.activeCancellations.has(job.url);
    const waitIfPaused = async () => {
        while (window.activePauses.has(jobId) || window.activePauses.has(job.url)) {
            if (checkCancel()) throw new Error('Cancelled');
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    };
    const statusInfo = { set textContent(value) { report(String(value)); }, get textContent() { return ''; } };
    const loadingBar = {
        parentNode: { querySelector: selector => selector === '.download-status-info' ? statusInfo : null },
        setAttribute: name => { if (name === 'indeterminate') report(undefined, undefined, true); },
        removeAttribute: () => {},
        set value(value) { report(undefined, Number(value)); },
        get value() { return 0; },
        set max(value) {}
    };

    try {
        await waitIfPaused();
        await report('Connecting...', 0);
        let filename = job.filename;
        let blob;

        if (job.audioUrl && !job.audioOnly) {
            report('Downloading video and audio...', 0, true);
            blob = await downloadAndMuxYoutube(job.url, job.audioUrl, filename, job.downloadMethod || 'browser', loadingBar, true);
        } else {
            const fetched = await browser.runtime.sendMessage({
                action: 'fetchMediaForAudio', url: job.url, request: job.request, jobId
            });
            if (!fetched?.success) throw new Error(fetched?.error || 'Media download failed');
            blob = new Blob([fetched.arrayBuffer], { type: fetched.mime || 'application/octet-stream' });
        }

        await waitIfPaused();
        if (job.encodeM4aToMp3) {
            report('Converting to MP3...');
            const result = await convertM4aToMp3Direct(blob, filename, loadingBar, checkCancel);
            blob = result.blob;
            filename = result.filename;
        } else if (job.audioOnly && !job.directAudioSource) {
            report('Extracting Audio...');
            const wav = await offlineExtractAudioToWav(blob, loadingBar, checkCancel);
            let result = { blob: wav, filename };
            if (typeof convertAudioToMp3IfEnabled !== 'undefined') {
                result = await convertAudioToMp3IfEnabled(wav, filename, loadingBar, checkCancel);
            }
            blob = result.blob;
            filename = result.filename;
        }

        await waitIfPaused();
        if (options.offscreen) {
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        } else {
            const cacheId = 'processed_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            await storeCompletedDownloadBlob(cacheId, blob, blob.type);
            const saved = await browser.runtime.sendMessage({
                action: 'download_cached_blob', cacheId, filename, mime: blob.type, size: blob.size
            });
            if (!saved?.success) throw new Error(saved?.error || 'Save failed');
        }
        await markRecoveryCompleted(key, job);
        await browser.runtime.sendMessage({ action: 'audioJobComplete', jobId, success: true });
    } catch (error) {
        if (job.recovered && !checkCancel() && error?.message !== 'Cancelled') {
            keepRecoveryJob = true;
            await browser.runtime.sendMessage({ action: 'parkProcessingJob', key, error: error?.message });
            return;
        }
        await browser.runtime.sendMessage({ action: 'audioJobComplete', jobId, success: false, error: error?.message || String(error) });
    } finally {
        if (!keepRecoveryJob) await browser.storage.local.remove(key);
        if (!options.offscreen && browser.tabs) {
            const tab = await browser.tabs.getCurrent().catch(() => null);
            if (tab?.id !== undefined) browser.tabs.remove(tab.id).catch(() => {});
        }
    }
}

globalThis.runPersistentAudioJob = runPersistentAudioJob;
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'pausePersistentAudioJob' || message.action === 'resumePersistentAudioJob') {
        window.activePauses = window.activePauses || new Set();
        const paused = message.action === 'pausePersistentAudioJob';
        const apply = job => {
            for (const value of [message.jobId, job?.url, ...(Array.isArray(job?.audioUrl) ? job.audioUrl.map(x => x.url) : [job?.audioUrl])].filter(Boolean)) {
                if (paused) window.activePauses.add(value); else window.activePauses.delete(value);
            }
        };
        browser.storage.local.get(`audioJob_${message.jobId}`).then(stored => apply(stored[`audioJob_${message.jobId}`]));
        sendResponse({ success: true });
        return;
    }
    if (message.action !== 'cancelPersistentAudioJob') return;
    window.activeCancellations = window.activeCancellations || new Set();
    window.activeCancellations.add(message.jobId);
    if (message.url) window.activeCancellations.add(message.url);
    const audioUrls = Array.isArray(message.audioUrl) ? message.audioUrl.map(item => item.url) : [message.audioUrl];
    for (const url of audioUrls.filter(Boolean)) window.activeCancellations.add(url);
    if (window.activeAbortControllers) {
        for (const controller of window.activeAbortControllers.values()) controller.abort();
    }
});
const initialJobId = new URLSearchParams(location.search).get('job');
if (initialJobId) runPersistentAudioJob(initialJobId);
