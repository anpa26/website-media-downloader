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

async function setPersistentJobPaused(item, jobId, isPaused) {
    const prefix = item.isAudioJob ? "audioJob_" : item.isPersistentZipJob ? "zipJob_" : "streamJob_";
    const key = prefix + jobId;
    const stored = await browser.storage.local.get(key);
    if (!stored[key]) return;
    stored[key].isPaused = isPaused;
    await browser.storage.local.set({ [key]: stored[key] });
}

// Serialize checkpoints so concurrent downloads cannot erase each other's state.
let pendingDownloadWrites = Promise.resolve();
function updatePendingDownloads(update) {
    const write = pendingDownloadWrites.then(async () => {
        const result = await browser.storage.local.get('pending-downloads');
        const pending = result['pending-downloads'] || {};
        update(pending);
        await browser.storage.local.set({ 'pending-downloads': pending });
    });
    pendingDownloadWrites = write.catch(error => console.error('Download checkpoint failed:', error));
    return write;
}

let antreanTulisSession = Promise.resolve();
function antreTulisSession(tulis) {
    const tugas = antreanTulisSession.then(() => tulis());
    antreanTulisSession = tugas.catch((error) => console.error('[website-media-downloader] Gagal nulis session:', error));
    return tugas;
}

function saveDownloadState(downloadId, data) {
    if (!data) return Promise.resolve();
    const paused = data.isPaused === true || data.isPaused === "true";
    const snapshot = {
        url: data.url, filename: data.filename,
        total: Number(data.total) || 0, loaded: Number(data.loaded) || 0,
        originalRequest: data.originalRequest, chunkIndex: data.chunkIndex || 0,
        timestamp: Date.now(), isParallel: !!data.isParallel,
        isPaused: paused,
        recoveryState: data.recoveryState || (paused ? "paused" : "running"),
        recoveryJobId: data.recoveryJobId,
        isNative: !!data.isNative, isCachedSave: !!data.isCachedSave, chunkIndexMode: data.chunkIndexMode,
        dropboxSessionId: data.dropboxSessionId,
        mediaType: data.mediaType || getMediaType(data.url, []),
        status: data.status
    };
    return updatePendingDownloads(pending => { pending[downloadId] = snapshot; });
}

function removeDownloadState(downloadId) {
    return updatePendingDownloads(pending => { delete pending[downloadId]; });
}

async function removeMediaRequest(url) {
    if (!url) return;
    return antreTulisSession(async () => {
    try {
        const baseUrl = url.split('?')[0];
        const res = await browser.storage.session.get(null);

        const activeUrls = new Set();
        for (const val of activeDownloads.values()) {
            if (val.url) activeUrls.add(val.url);
        }

        const keysToRemove = [];
        for (const key in res) {

            if (key.split('?')[0] === baseUrl && !activeUrls.has(key)) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            await browser.storage.session.remove(keysToRemove);
        }
    } catch (e) {
        console.error("Error in removeMediaRequest:", e);

        browser.storage.session.remove(url).catch(() => {});
    }
    });
}

globalThis.staleDownloadStateCleanupReady ??= Promise.resolve();

function processingJobInfo(key, job) {
    const isAudioJob = key.startsWith('audioJob_');
    const isZip = key.startsWith('zipJob_');
    const isPopupJob = key.startsWith('popupJob_');
    return {
        id: job.jobId, url: isZip ? `zip://${job.jobId}` : job.url,
        filename: job.filename, audioUrl: job.audioUrl,
        loaded: 0, total: isZip ? (job.items || []).length : 100,
        percent: job.percent ?? 0, isPaused: !!job.isPaused,
        status: job.status || (job.isPaused ? 'Paused' : 'Preparing ZIP...'),
        mediaType: isZip ? 'file' : (job.mediaType || (isAudioJob ? (job.audioOnly ? 'audio' : 'video') : 'stream')),
        isAudioJob, isStreamJob: !isAudioJob && !isZip && !isPopupJob,
        isZip, isPersistentZipJob: isZip, recoveryKey: key,
        groupType: job.groupType || null
    };
}

async function restorePersistentProcessingJobs() {
    const stored = await browser.storage.local.get(null);
    const staleKeys = [];
    for (const [key, job] of Object.entries(stored)) {
        if (!/^(audio|stream|zip|popup)Job_/.test(key) || !job?.jobId) continue;
        if (job.recoveryState === 'completed' || job.recoveryState === 'cancelled' || job.status === 'Cancelled' || job.status === 'completed') {
            staleKeys.push(key);
            continue;
        }
        if (key.startsWith('popupJob_')) {
            staleKeys.push(key);
            continue;
        }
        if (!activeDownloads.has(job.jobId)) {
            job.isPaused = true;
            job.status = 'Paused';
            activeDownloads.set(job.jobId, processingJobInfo(key, job));
        }
    }
    if (staleKeys.length > 0) {
        browser.storage.local.remove(staleKeys).catch(() => {});
    }
}

async function discardStaleDownloadState() {
    const stored = await browser.storage.local.get(null);
    if (stored['pending-downloads']) await browser.storage.local.remove('pending-downloads');
}

async function resumeSavedDownload(id) {
    const item = activeDownloads.get(id);
    if (!item) return;
    if (item.recoveryKey) return restartProcessingJob(id);
    if (item.isCachedSave) {
        item.isPaused = false;
        updateActiveDownloadsBadge().catch(() => {});
        pendingSaveQueue.push({ id, url: item.url, filename: item.filename });
        processSaveQueue();
        return;
    }
    if (item.isNative) {
        try {
            await browser.downloads.resume(Number(id));
            item.isPaused = false;
            updateActiveDownloadsBadge().catch(() => {});
            item.recoveryState = "running";
        } catch (error) {
            item.isPaused = true;
            updateActiveDownloadsBadge().catch(() => {});
            item.status = error.message;
        }
        await saveDownloadState(id, item);
        return;
    }
    item.isPaused = false;
    updateActiveDownloadsBadge().catch(() => {});
    item.recoveryState = "running";
    item.isManualResume = true;
    return handleFetchDownload(item.url, item.filename, item.originalRequest, id, true, true,
        item.loaded, item.mediaType, item.dropboxSessionId);
}
staleDownloadStateCleanupReady = discardStaleDownloadState().catch(error => console.error("Stale download cleanup failed:", error));
staleDownloadStateCleanupReady.then(() => restorePersistentProcessingJobs())
    .catch(error => console.error("Processing job restore failed:", error));
