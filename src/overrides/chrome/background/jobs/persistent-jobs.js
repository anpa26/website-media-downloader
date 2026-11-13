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

let antreanTulisSession = Promise.resolve();
function antreTulisSession(tulis) {
    const tugas = antreanTulisSession.then(() => tulis());
    antreanTulisSession = tugas.catch((error) => console.error('[website-media-downloader] Gagal nulis session:', error));
    return tugas;
}

async function saveDownloadState(downloadId, data) {
    const res = await browser.storage.local.get('pending-downloads');
    const pending = res['pending-downloads'] || {};
    pending[downloadId] = {
        url: data.url,
        filename: data.filename,
        total: parseInt(data.total) || 0,
        loaded: parseInt(data.loaded) || 0,
        originalRequest: data.originalRequest,
        chunkIndex: data.chunkIndex || 0,
        timestamp: Date.now(),
        isParallel: !!data.isParallel,
        isPaused: data.isPaused === true || data.isPaused === "true",
        recoveryState: data.recoveryState || ((data.isPaused === true || data.isPaused === "true") ? "paused" : "running"),
        dropboxSessionId: data.dropboxSessionId,
        mediaType: data.mediaType || getMediaType(data.url, []),
        status: data.status
    };
    await browser.storage.local.set({ 'pending-downloads': pending });
}

async function removeDownloadState(downloadId) {
    const res = await browser.storage.local.get('pending-downloads');
    const pending = res['pending-downloads'] || {};
    delete pending[downloadId];
    await browser.storage.local.set({ 'pending-downloads': pending });
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
    const penyimpananSesi = (typeof browser !== 'undefined' && browser.storage && browser.storage.session) ? browser.storage.session : (typeof browser !== 'undefined' && browser.storage ? browser.storage.local : null);
    if (!penyimpananSesi) return;
    const session = await penyimpananSesi.get("recovery-startup-cleaned");
    if (session["recovery-startup-cleaned"]) return;
    await penyimpananSesi.set({ "recovery-startup-cleaned": true });
    const stored = await browser.storage.local.get(null);
    if (stored['pending-downloads']) await browser.storage.local.remove('pending-downloads');
}

discardStaleDownloadState()
    .then(() => restorePersistentProcessingJobs())
    .catch(error => console.error('Processing job restore failed:', error));

