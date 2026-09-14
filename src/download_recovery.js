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

const processingJobClaims = new Map();
const processingJobStarts = new Map();
let staleDownloadStateCleanupReady = Promise.resolve();
async function getCommittedDownloadPrefix(downloadId, savedMode) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([CHUNK_STORE_NAME], 'readwrite');
        const range = IDBKeyRange.bound([downloadId, 0], [downloadId, Infinity]);
        const request = tx.objectStore(CHUNK_STORE_NAME).openCursor(range);
        let offset = 0, count = 0, mode = savedMode, gap = false;
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const chunk = cursor.value;
            const size = chunk.data?.size ?? chunk.data?.byteLength ?? chunk.data?.length ?? 0;
            if (!mode && count > 0) mode = chunk.chunkIndex === count && count !== offset ? 'ordinal' : 'bytes';
            const expected = mode === 'ordinal' ? count : offset;
            if (gap || chunk.chunkIndex !== expected || size <= 0) {
                gap = true;
                // Discard the sparse tail to avoid overlapping chunks after the restart.
                cursor.delete();
            } else {
                offset += size;
                count++;
            }
            cursor.continue();
        };
        tx.oncomplete = () => resolve({ offset, mode: mode || 'bytes', nextIndex: mode === 'ordinal' ? count : offset });
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Checkpoint transaction aborted'));
    });
}

function processingJobInfo(key, job) {
    const isAudioJob = key.startsWith('audioJob_');
    const isZip = key.startsWith('zipJob_');
    const isPopupJob = key.startsWith('popupJob_');
    return {
        id: job.jobId, url: isZip ? `zip://${job.jobId}` : job.url,
        filename: job.filename, audioUrl: job.audioUrl,
        loaded: 0, total: isZip ? (job.items || []).length : 100,
        percent: 0, isPaused: true, status: 'Paused',
        mediaType: isZip ? 'file' : (job.mediaType || (isAudioJob ? (job.audioOnly ? 'audio' : 'video') : 'stream')),
        isAudioJob, isStreamJob: !isAudioJob && !isZip && !isPopupJob,
        isZip, isPersistentZipJob: isZip, recoveryKey: key
    };
}

function restartProcessingJob(jobId) {
    if (processingJobStarts.has(jobId)) return processingJobStarts.get(jobId);
    const start = (async () => {
        const item = activeDownloads.get(jobId);
        if (!item?.recoveryKey) return;
        const stored = await browser.storage.local.get(item.recoveryKey);
        const job = stored[item.recoveryKey];
        if (!job || activeDownloads.get(jobId) !== item) return;
        job.isPaused = false;
        job.recoveryState = "running";
        await browser.storage.local.set({ [item.recoveryKey]: job });
        item.isPaused = false;
        item.percent = 0;
        item.status = 'Restarting...';
        const page = item.recoveryKey.startsWith('popupJob_') ? 'popup.html' :
            item.isAudioJob ? 'audio_processor.html' : 'stream_processor.html';
        const parameter = page === 'popup.html' ? 'recoveryJob' : item.isZip ? 'zipJob' : 'job';
        const url = browser.runtime.getURL(`${page}?${parameter}=${encodeURIComponent(jobId)}`);
        const tabs = await browser.tabs.query({});
        const existing = tabs.find(tab => {
            if (!tab.url?.startsWith(browser.runtime.getURL(page))) return false;
            return new URL(tab.url).searchParams.get(parameter) === jobId;
        });
        const tab = existing || await browser.tabs.create({ url, active: false });
        if (existing && !processingJobClaims.has(item.recoveryKey)) await browser.tabs.reload(existing.id);
        item.processorTabId = tab.id;
        if (item.isZip) persistentZipJobs.set(jobId, { ...job, processorTabId: tab.id });
        if (item.isStreamJob) persistentStreamJobs.set(jobId, { ...job, processorTabId: tab.id });
    })().catch(error => {
        const item = activeDownloads.get(jobId);
        if (item) { item.isPaused = true; item.status = error.message; }
        throw error;
    }).finally(() => processingJobStarts.delete(jobId));
    processingJobStarts.set(jobId, start);
    return start;
}

async function finalizeProcessingRecovery(key, state = "completed") {
    try {
        const stored = await browser.storage.local.get(key);
        const job = stored[key];
        if (!job) return;
        job.recoveryState = state;
        job.status = state;
        await browser.storage.local.set({ [key]: job });
        await browser.storage.local.remove(key);
    } catch (error) {
        console.warn("Failed to finalize processing recovery:", error);
    }
}

async function pauseProcessingJob(jobId) {
    const item = activeDownloads.get(jobId);
    if (!item?.recoveryKey) return;
    const stored = await browser.storage.local.get(item.recoveryKey);
    const job = stored[item.recoveryKey];
    if (!job) return;
    job.isPaused = true;
    job.recoveryState = "paused";
    await browser.storage.local.set({ [item.recoveryKey]: job });
    item.isPaused = true;
    item.status = "Paused";
    processingJobClaims.delete(item.recoveryKey);
    if (item.processorTabId !== undefined) await browser.tabs.remove(item.processorTabId).catch(() => {});
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'parkProcessingJob') {
        (async () => {
            const job = (await browser.storage.local.get(message.key))[message.key];
            if (!job) return { success: false };
            job.isPaused = true;
            job.recoveryState = "paused";
            await browser.storage.local.set({ [message.key]: job });
            const item = activeDownloads.get(job.jobId);
            if (item) {
                item.isPaused = true;
                item.status = message.error || 'Paused';
                browser.runtime.sendMessage({ action: 'downloadPaused', id: job.jobId,
                    loaded: item.loaded, total: item.total }).catch(() => {});
            }
            processingJobClaims.delete(message.key);
            return { success: true };
        })().then(sendResponse);
        return true;
    }
    if (message.action === 'registerPopupRecovery') {
        const job = message.job;
        job.recoveryState = "running";
        const key = `popupJob_${job.jobId}`;
        browser.storage.local.set({ [key]: job }).then(() => {
            if (activeDownloads.has(job.jobId)) activeDownloads.set(job.jobId, { ...processingJobInfo(key, job),
                isPaused: false, processorTabId: sender.tab?.id });
            sendResponse({ success: true });
        }, error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    if (message.action === 'releasePopupRecovery') {
        const key = `popupJob_${message.jobId}`;
        browser.storage.local.remove(key).then(() => {
            if (activeDownloads.get(message.jobId)?.recoveryKey === key) activeDownloads.delete(message.jobId);
            processingJobClaims.delete(key);
            sendResponse({ success: true });
        });
        return true;
    }
    if (message.action === 'claimProcessingJob') {
        (async () => {
            await staleDownloadStateCleanupReady;
            const key = message.key;
            if (!/^(audio|stream|zip|popup)Job_/.test(key)) return { allowed: false };
            const job = (await browser.storage.local.get(key))[key];
            if (!job || job.isPaused) return { allowed: false };
            const owner = processingJobClaims.get(key);
            if (owner !== undefined) return { allowed: false };
            processingJobClaims.set(key, sender.tab?.id ?? -1);
            const item = activeDownloads.get(job.jobId);
            if (item) { item.isPaused = false; item.processorTabId = sender.tab?.id; }
            return { allowed: true };
        })().then(sendResponse, () => sendResponse({ allowed: false }));
        return true;
    }
});

browser.tabs.onRemoved.addListener(tabId => {
    for (const [key, owner] of processingJobClaims) {
        if (owner === tabId) processingJobClaims.delete(key);
    }
});
