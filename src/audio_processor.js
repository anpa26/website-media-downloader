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

async function saveOffscreenAudioBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    try {
        await browser.downloads.download({ url: objectUrl, filename, saveAs: false });
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

function safeTrackName(value, fallback) {
    return String(value || fallback).replace(/[\\/:*?"<>|]/g, '_').trim() || fallback;
}

async function fetchProcessorBlob(url, jobId, request) {
    const fetched = await browser.runtime.sendMessage({ action: 'fetchMediaForAudio', url, request, jobId });
    if (!fetched?.success) throw new Error(fetched?.error || 'Media download failed');
    return new Blob([fetched.arrayBuffer], { type: fetched.mime || 'application/octet-stream' });
}

async function fetchProcessorSubtitle(track) {
    const fetched = await browser.runtime.sendMessage({ action: 'fetchText', url: track.vttUrl });
    if (fetched?.text) return fetched.text;
    const response = await spoofedFetch(track.vttUrl);
    if (!response.ok) throw new Error(`Subtitle request failed: ${response.status}`);
    return response.text();
}

function convertProcessorSubtitle(text, format) {
    if (format === 'srt') {
        if (globalThis.subsrt?.convert) return globalThis.subsrt.convert(text, { format: 'srt' });
        return text.replace(/^WEBVTT[^\n]*\n+/i, '').replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
    }
    if (!/^WEBVTT/i.test(text.trim())) {
        return 'WEBVTT\n\n' + text.trim().replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }
    return text;
}

async function processYoutubeTrackBundle(job, jobId, loadingBar, report) {
    const bundle = job.youtubeTracks || {};
    let videoBlob;
    if (job.audioUrl) {
        report('Downloading and muxing video tracks...', 0, true);
        videoBlob = await downloadAndMuxYoutube(job.url, job.audioUrl, job.filename, job.downloadMethod || 'browser', loadingBar, true);
    } else {
        report('Downloading video...', 0, true);
        videoBlob = await fetchProcessorBlob(job.url, jobId, job.request);
    }

    const subtitles = [];
    for (let i = 0; i < (bundle.subtitles || []).length; i++) {
        const track = bundle.subtitles[i];
        report(`Downloading subtitle ${i + 1}/${bundle.subtitles.length}: ${track.displayName || track.language || 'Subtitle'}`, undefined, true);
        const text = await fetchProcessorSubtitle(track);
        subtitles.push({ ...track, text });
    }

    if (bundle.embedSubtitles && subtitles.length) {
        report('Embedding subtitle tracks...', undefined, true);
        videoBlob = await embedSubtitlesWithLibAV(videoBlob, subtitles, 'mp4', job.filename, job.downloadMethod || 'browser', loadingBar, true);
    }

    if (!bundle.zip) {
        const ext = '.mp4';
        return { blob: videoBlob, filename: job.filename.replace(/\.[a-z0-9]+$/i, '') + ext };
    }

    const base = job.filename.replace(/\.[a-z0-9]+$/i, '');
    const videoEntryName = base + '.mp4';
    const entries = [{ name: videoEntryName, input: videoBlob }];
    for (let i = 0; i < (bundle.audioFiles || []).length; i++) {
        const track = bundle.audioFiles[i];
        report(`Downloading audio ${i + 1}/${bundle.audioFiles.length}: ${track.name || 'Audio'}`, undefined, true);
        const blob = await fetchProcessorBlob(track.url, jobId, job.request);
        const ext = /webm/i.test(track.url) ? '.webm' : '.m4a';
        entries.push({ name: `${base} - ${safeTrackName(track.name, `Audio ${i + 1}`)}${ext}`, input: blob });
    }
    const subFormat = bundle.subtitleFormat === 'srt' ? 'srt' : 'vtt';
    if (!bundle.embedSubtitles) {
        for (let i = 0; i < subtitles.length; i++) {
            const track = subtitles[i];
            entries.push({
                name: `${base} - ${safeTrackName(track.displayName || track.language, `Subtitle ${i + 1}`)}.${subFormat}`,
                input: convertProcessorSubtitle(track.text, subFormat)
            });
        }
    }
    report('Generating ZIP archive...', undefined, true);
    return { blob: await downloadZip(entries).blob(), filename: `${base}.zip` };
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

    const report = (text, percent, indeterminate = false) => {
        // Progress delivery is best-effort. A stale extension page must never
        // be able to block the actual processor by holding a response open.
        browser.runtime.sendMessage({
            action: 'audioJobProgress', jobId, filename: job.filename, url: job.url, text, percent, indeterminate
        }).catch(() => {});
    };
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
        report('Connecting...', 0);
        let filename = job.filename;
        let blob;

        if (job.youtubeTracks) {
            const result = await processYoutubeTrackBundle(job, jobId, loadingBar, report);
            blob = result.blob;
            filename = result.filename;
        } else if (job.audioUrl && !job.audioOnly) {
            report('Downloading video and audio...', 0, true);
            blob = await downloadAndMuxYoutube(job.url, job.audioUrl, filename, job.downloadMethod || 'browser', loadingBar, true);
        } else {
            blob = await fetchProcessorBlob(job.url, jobId, job.request);
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
            await saveOffscreenAudioBlob(blob, filename);
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
            const bundleUrls = [
                ...(job?.youtubeTracks?.audioFiles || []).map(x => x.url),
                ...(job?.youtubeTracks?.subtitles || []).map(x => x.vttUrl)
            ];
            for (const value of [message.jobId, job?.url, ...(Array.isArray(job?.audioUrl) ? job.audioUrl.map(x => x.url) : [job?.audioUrl]), ...bundleUrls].filter(Boolean)) {
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
    for (const track of message.youtubeTracks?.audioFiles || []) if (track.url) window.activeCancellations.add(track.url);
    for (const track of message.youtubeTracks?.subtitles || []) if (track.vttUrl) window.activeCancellations.add(track.vttUrl);
    if (window.activeAbortControllers) {
        for (const controller of window.activeAbortControllers.values()) controller.abort();
    }
});
const initialJobId = new URLSearchParams(location.search).get('job');
if (initialJobId) runPersistentAudioJob(initialJobId);
