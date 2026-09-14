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

// An offscreen document cannot present an actionable confirmation dialog.
// Fail visibly in the popup instead of leaving a DRM job waiting forever.
if (typeof mdui !== 'undefined') {
    mdui.confirm = async () => {
        throw new Error('DRM-protected streams require an interactive download page');
    };
}

const runningStreamJobs = new Map();
const runningZipJobs = new Map();
let streamJobQueue = Promise.resolve();
let routeStreamToDownloadManager = false;
let capturedStreamFiles = null;
const originalFinalizeDownload = globalThis.finalizeDownload;

// Firefox runs this processor in a hidden extension tab. Hand the completed
// blob to the same IndexedDB-backed download manager used by audio-only jobs.
// Chrome's offscreen document keeps the native offscreen save path because
// transferring large ArrayBuffers through runtime messaging is less reliable.
globalThis.finalizeDownload = async function(blob, filename, downloadMethod, loadingBar, streamedToGDrive, streamedToDropbox) {
    if (capturedStreamFiles && blob && !streamedToGDrive && !streamedToDropbox) {
        if (typeof ensureFileExtension === 'function') filename = ensureFileExtension(filename, blob.type);
        capturedStreamFiles.push({ filename, blob });
        return;
    }
    if (routeStreamToDownloadManager && blob && !streamedToGDrive && !streamedToDropbox) {
        if (typeof ensureFileExtension === 'function') filename = ensureFileExtension(filename, blob.type);
        const cacheId = 'processed_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        await storeCompletedDownloadBlob(cacheId, blob, blob.type);
        const saved = await browser.runtime.sendMessage({
            action: 'download_cached_blob', cacheId, filename, mime: blob.type, size: blob.size
        });
        if (!saved?.success) throw new Error(saved?.error || 'Unable to open download manager');
        return;
    }
    return originalFinalizeDownload(blob, filename, downloadMethod, loadingBar, streamedToGDrive, streamedToDropbox);
};
globalThis.activeCancellations = globalThis.activeCancellations || new Set();
globalThis.activePauses = globalThis.activePauses || new Set();

function createStreamProgressReporter(job) {
    let percent = 0;
    let text = 'Preparing stream...';
    const report = (indeterminate = false) => browser.runtime.sendMessage({
        action: job.zipBatch ? 'zipProcessorProgress' : 'streamJobProgress',
        jobId: job.jobId,
        url: job.url,
        filename: job.filename,
        status: job.zipBatch ? 'processingStream' : undefined,
        currentFile: job.zipBatch ? job.filename : undefined,
        text,
        percent: indeterminate ? undefined : percent,
        indeterminate
    }).catch(() => {});
    const statusInfo = {
        set textContent(value) { text = String(value || 'Processing stream...'); report(false); },
        get textContent() { return text; }
    };
    return {
        parentNode: { querySelector: selector => selector === '.download-status-info' ? statusInfo : null },
        setAttribute(name) { if (name === 'indeterminate') report(true); },
        removeAttribute() {},
        set value(value) { percent = Number(value) || 0; report(false); },
        get value() { return percent; },
        set max(value) {},
        get max() { return 100; }
    };
}

async function markRecoveryCompleted(key, job) {
    await browser.storage.local.set({ [key]: { ...job, recoveryState: "completed", status: "completed" } });
}

async function runPersistentStreamJob(jobId, options = {}) {
    if (runningStreamJobs.has(jobId)) return;
    const key = `streamJob_${jobId}`;
    const stored = await browser.storage.local.get(key);
    const job = stored[key];
    let keepRecoveryJob = false;
    if (!job) return;
    if (typeof browser.runtime.getBrowserInfo === 'function' && !options.offscreen) {
        const claim = await browser.runtime.sendMessage({ action: 'claimProcessingJob', key });
        if (!claim?.allowed) return;
    }
    runningStreamJobs.set(jobId, job);
    routeStreamToDownloadManager = !options.offscreen && !job.zip;
    if (job.zip) capturedStreamFiles = [];
    activeCancellations.delete(job.url);
    if (job.isPaused) activePauses.add(job.url);

    const quality = job.quality || 'highest';
    history.replaceState(null, '', `${location.pathname}?job=${encodeURIComponent(jobId)}&quality=${encodeURIComponent(quality)}`);
    const loadingBar = createStreamProgressReporter(job);
    let request = job.request || {};
    if (!request.requestHeaders?.length) {
        const mediaRequests = await browser.runtime.sendMessage({ action: 'getMediaRequests' }).catch(() => ({}));
        const requests = mediaRequests?.[job.url] || [];
        request = requests.find(item => item.size === job.size) || requests[0] || request;
    }
    const headers = request.requestHeaders || [];

    try {
        await browser.runtime.sendMessage({
            action: 'streamJobProgress', jobId, url: job.url, filename: job.filename,
            text: 'Preparing stream...', percent: undefined, indeterminate: true
        });
        if (job.url.toLowerCase().includes('.m3u8')) {
            await downloadM3U8Offline(job.url, headers, job.downloadMethod || 'browser', loadingBar, request, job.filename, !!job.audioOnly);
        } else if (job.url.toLowerCase().includes('.mpd')) {
            await downloadMPDOffline(job.url, headers, job.downloadMethod || 'browser', loadingBar, request, job.filename, !!job.audioOnly);
        } else {
            throw new Error('Unsupported stream format');
        }
        if (activeCancellations.has(job.url)) throw new Error('Cancelled');
        await markRecoveryCompleted(key, job);
        if (job.zip) {
            const files = [];
            for (const file of capturedStreamFiles || []) {
                files.push({ filename: file.filename, mime: file.blob.type, arrayBuffer: await file.blob.arrayBuffer() });
            }
            if (files.length === 0) throw new Error('Stream processor produced no files');
            await browser.runtime.sendMessage({ action: 'streamZipComplete', jobId, success: true, files });
        } else {
            await browser.runtime.sendMessage({
                action: 'streamJobComplete', jobId, url: job.url,
                filename: job.filename, success: true
            });
        }
    } catch (error) {
        const cancelled = activeCancellations.has(job.url) || error?.message === 'Cancelled';
        if (job.recovered && !cancelled) {
            keepRecoveryJob = true;
            await browser.runtime.sendMessage({ action: 'parkProcessingJob', key, error: error?.message });
            return;
        }
        await browser.runtime.sendMessage(job.zip ? {
            action: 'streamZipComplete', jobId, success: false,
            error: cancelled ? 'USER_CANCELED' : (error?.message || String(error))
        } : {
            action: 'streamJobComplete', jobId, url: job.url,
            filename: job.filename, success: false,
            error: cancelled ? 'USER_CANCELED' : (error?.message || String(error))
        });
    } finally {
        activeCancellations.delete(job.url);
        routeStreamToDownloadManager = false;
        capturedStreamFiles = null;
        activePauses.delete(job.url);
        runningStreamJobs.delete(jobId);
        if (!keepRecoveryJob) await browser.storage.local.remove(key);
        if (!options.offscreen && browser.tabs) {
            const tab = await browser.tabs.getCurrent().catch(() => null);
            if (tab?.id !== undefined) browser.tabs.remove(tab.id).catch(() => {});
        }
    }
}

function uniqueZipFilename(filename, usedNames) {
    let result = filename || 'file';
    let counter = 1;
    while (usedNames.has(result)) {
        const parts = result.split('.');
        const ext = parts.length > 1 ? '.' + parts.pop() : '';
        result = `${parts.join('.')}_${counter}${ext}`;
        counter++;
    }
    usedNames.add(result);
    return result;
}

async function runPersistentZipJob(jobId, options = {}) {
    await ensureClientZipLoaded();
    if (runningZipJobs.has(jobId)) return;
    const key = `zipJob_${jobId}`;
    const stored = await browser.storage.local.get(key);
    const job = stored[key];
    let keepRecoveryJob = false;
    if (!job) return;
    if (typeof browser.runtime.getBrowserInfo === 'function' && !options.offscreen) {
        const claim = await browser.runtime.sendMessage({ action: 'claimProcessingJob', key });
        if (!claim?.allowed) return;
    }
    const state = { cancelled: false, paused: !!job.isPaused, controller: null, currentUrl: null };
    runningZipJobs.set(jobId, state);
    const report = (status, data = {}) => browser.runtime.sendMessage({
        action: 'zipProcessorProgress', jobId, status, ...data
    }).catch(() => {});
    const throwIfCancelled = () => {
        if (state.cancelled) throw new Error('Cancelled');
    };
    const waitIfPaused = async () => {
        while (state.paused) { throwIfCancelled(); await new Promise(resolve => setTimeout(resolve, 200)); }
    };

    try {
        const usedNames = new Set();
        const entries = [];
        const items = job.items || [];
        for (let index = 0; index < items.length; index++) {
            throwIfCancelled();
            await waitIfPaused();
            const item = items[index];
            state.currentUrl = item.url;
            report('downloading', { loaded: index, total: items.length, currentFile: item.filename });

            if (/\.(m3u8|mpd)(?:$|[?#])/i.test(item.url)) {
                capturedStreamFiles = [];
                history.replaceState(null, '', `${location.pathname}?quality=${encodeURIComponent(item.quality || 'highest')}`);
                const streamJob = {
                    jobId, url: item.url, filename: item.filename,
                    request: item.request || item.originalRequest || {}, zipBatch: true
                };
                const loadingBar = createStreamProgressReporter(streamJob);
                const request = streamJob.request;
                const headers = request.requestHeaders || [];
                activeCancellations.delete(item.url);
                if (item.url.toLowerCase().includes('.mpd')) {
                    await downloadMPDOffline(item.url, headers, 'browser', loadingBar, request, item.filename, false);
                } else {
                    await downloadM3U8Offline(item.url, headers, 'browser', loadingBar, request, item.filename, false);
                }
                throwIfCancelled();
                for (const file of capturedStreamFiles || []) {
                    entries.push({ name: uniqueZipFilename(file.filename, usedNames), input: file.blob });
                }
                capturedStreamFiles = null;
            } else {
                const request = item.request || item.originalRequest || {};
                const headers = {};
                for (const header of request.requestHeaders || []) {
                    if (!['cookie', 'host', 'content-length', 'range'].includes(header.name.toLowerCase())) headers[header.name] = header.value;
                }
                const fetchOptions = {
                    method: request.method || 'GET', headers, credentials: 'include',
                    referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === 'referer')?.value || ''
                };
                if (request.method && request.method !== 'GET' && request.requestBody) {
                    if (request.requestBody.type === 'formData') {
                        const formData = new FormData();
                        for (const field in request.requestBody.data) {
                            request.requestBody.data[field].forEach(value => formData.append(field, value));
                        }
                        fetchOptions.body = formData;
                    } else if (request.requestBody.type === 'base64') {
                        const binary = atob(request.requestBody.data);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                        fetchOptions.body = bytes;
                    }
                }
                state.controller = new AbortController();
                fetchOptions.signal = state.controller.signal;
                const response = await fetch(item.url, fetchOptions);
                if (!response.ok) throw new Error(`Server returned ${response.status}`);
                const reader = response.body.getReader();
                const chunks = [];
                while (true) {
                    await waitIfPaused();
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
                const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
                let filename = item.filename || 'file';
                if (typeof ensureFileExtension === 'function') filename = ensureFileExtension(filename, blob.type);
                entries.push({ name: uniqueZipFilename(filename, usedNames), input: blob });
            }
            report('downloading', { loaded: index + 1, total: items.length, currentFile: item.filename });
        }

        throwIfCancelled();
        report('generating', { loaded: items.length, total: items.length });
        const zipBlob = await downloadZip(entries).blob();
        throwIfCancelled();
        if (zipBlob.size < 100) throw new Error('Generated ZIP is empty');
        const zipName = job.filename || `downloads_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

        if (options.offscreen) {
            const objectUrl = URL.createObjectURL(zipBlob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = zipName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        } else {
            const cacheId = 'processed_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            await storeCompletedDownloadBlob(cacheId, zipBlob, 'application/zip');
            const saved = await browser.runtime.sendMessage({
                action: 'download_cached_blob', cacheId, filename: zipName,
                mime: 'application/zip', size: zipBlob.size
            });
            if (!saved?.success) throw new Error(saved?.error || 'Unable to open download manager');
        }
        await markRecoveryCompleted(key, job);
        await browser.runtime.sendMessage({ action: 'zipProcessorComplete', jobId, success: true, filename: zipName });
    } catch (error) {
        if (job.recovered && !state.cancelled && error?.name !== 'AbortError') {
            keepRecoveryJob = true;
            await browser.runtime.sendMessage({ action: 'parkProcessingJob', key, error: error?.message });
            return;
        }
        await browser.runtime.sendMessage({
            action: 'zipProcessorComplete', jobId, success: false,
            error: state.cancelled || error?.name === 'AbortError' ? 'USER_CANCELED' : (error?.message || String(error))
        }).catch(() => {});
    } finally {
        if (state.currentUrl) activeCancellations.delete(state.currentUrl);
        capturedStreamFiles = null;
        runningZipJobs.delete(jobId);
        if (!keepRecoveryJob) await browser.storage.local.remove(key);
        if (!options.offscreen && browser.tabs) {
            const tab = await browser.tabs.getCurrent().catch(() => null);
            if (tab?.id !== undefined) browser.tabs.remove(tab.id).catch(() => {});
        }
    }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startOffscreenStreamJob') {
        streamJobQueue = streamJobQueue
            .then(() => runPersistentStreamJob(message.jobId, { offscreen: true }))
            .catch(error => console.error('Stream job queue failed:', error));
        sendResponse({ success: true });
    } else if (message.action === 'pausePersistentStreamJob' || message.action === 'resumePersistentStreamJob') {
        const paused = message.action === 'pausePersistentStreamJob';
        const key = `streamJob_${message.jobId}`;
        browser.storage.local.get(key).then(stored => {
            if (stored[key]) browser.storage.local.set({ [key]: { ...stored[key], isPaused: paused } });
        });
        const job = runningStreamJobs.get(message.jobId);
        if (job) { if (paused) activePauses.add(job.url); else activePauses.delete(job.url); }
        sendResponse({ success: true });
    } else if (message.action === 'cancelOffscreenStreamJob') {
        const job = runningStreamJobs.get(message.jobId);
        if (job) activeCancellations.add(job.url);
        sendResponse({ success: true });
    } else if (message.action === 'startOffscreenZipJob') {
        streamJobQueue = streamJobQueue
            .then(() => runPersistentZipJob(message.jobId, { offscreen: true }))
            .catch(error => console.error('ZIP job queue failed:', error));
        sendResponse({ success: true });
    } else if (message.action === 'pausePersistentZipJob' || message.action === 'resumePersistentZipJob') {
        const paused = message.action === 'pausePersistentZipJob';
        const key = `zipJob_${message.jobId}`;
        browser.storage.local.get(key).then(stored => {
            if (stored[key]) browser.storage.local.set({ [key]: { ...stored[key], isPaused: paused } });
        });
        const state = runningZipJobs.get(message.jobId);
        if (state) {
            state.paused = paused;
            if (state.currentUrl) { if (paused) activePauses.add(state.currentUrl); else activePauses.delete(state.currentUrl); }
        }
        sendResponse({ success: true });
    } else if (message.action === 'cancelOffscreenZipJob') {
        const state = runningZipJobs.get(message.jobId);
        if (state) {
            state.cancelled = true;
            state.controller?.abort();
            if (state.currentUrl) activeCancellations.add(state.currentUrl);
        }
        sendResponse({ success: true });
    }
});

globalThis.showDialog = globalThis.showDialog || (() => {});
globalThis.runPersistentStreamJob = runPersistentStreamJob;
const initialStreamJobId = new URLSearchParams(location.search).get('job');
const initialZipJobId = new URLSearchParams(location.search).get('zipJob');
if (initialStreamJobId) runPersistentStreamJob(initialStreamJobId);
else if (initialZipJobId) runPersistentZipJob(initialZipJobId);
