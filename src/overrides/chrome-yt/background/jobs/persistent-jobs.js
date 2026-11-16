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
        isPaused: data.isPaused === true || data.isPaused === 'true',
        dropboxSessionId: data.dropboxSessionId,
        mediaType: data.mediaType || getMediaType(data.url, [])
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

let wisResikSesiWingi = false;

function sesiAsliKasedhiya() {
    try {
        const sesi = browser.storage && browser.storage.session;
        return !!sesi && typeof sesi.getBytesInUse === 'function';
    } catch (_) {
        return false;
    }
}

function kunciJobLawase(kunci) {
    return /^(audio|stream|zip|popup)Job_/.test(kunci);
}

async function tutupTabProsesor() {
    try {
        const kabehTab = await browser.tabs.query({});
        const streamUrl = browser.runtime.getURL('pages/stream_processor.html');
        const audioUrl = browser.runtime.getURL('pages/audio_processor.html');
        const tabLawase = [];
        for (const tab of kabehTab || []) {
            if (!tab.url) continue;
            if (tab.url.startsWith(streamUrl) || tab.url.startsWith(audioUrl)) tabLawase.push(tab.id);
        }
        if (tabLawase.length > 0) await browser.tabs.remove(tabLawase);
    } catch (_) {}
    try {
        if (browser.offscreen && typeof browser.offscreen.closeDocument === 'function') {
            const onoDokumen = browser.offscreen.hasDocument ? await browser.offscreen.hasDocument().catch(() => false) : true;
            if (onoDokumen) await browser.offscreen.closeDocument().catch(() => {});
        }
    } catch (_) {}
}

async function bersihnoJobSesiWingi() {
    if (wisResikSesiWingi) return false;
    wisResikSesiWingi = true;
    if (sesiAsliKasedhiya()) {
        const tandha = await browser.storage.session.get('recovery-startup-cleaned');
        if (tandha && tandha['recovery-startup-cleaned']) return false;
        await browser.storage.session.set({ 'recovery-startup-cleaned': true });
    }
    const kabeh = await browser.storage.local.get(null);
    const kunciBusak = [];
    for (const kunci of Object.keys(kabeh || {})) {
        if (kunciJobLawase(kunci)) kunciBusak.push(kunci);
    }
    if (kabeh['pending-downloads']) kunciBusak.push('pending-downloads');
    if (kabeh['wmd_active_downloads']) kunciBusak.push('wmd_active_downloads');
    if (kunciBusak.length > 0) await browser.storage.local.remove(kunciBusak);
    for (const [id, item] of activeDownloads) {
        if (item && (item.isStreamJob || item.isAudioJob || item.isZip || item.isPersistentZipJob || (item.recoveryKey && kunciJobLawase(item.recoveryKey)))) activeDownloads.delete(id);
    }
    await tutupTabProsesor();
    return true;
}

if (sesiAsliKasedhiya()) {
    bersihnoJobSesiWingi().catch(error => console.error('Processing job cleanup failed:', error));
} else if (browser.runtime && browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(() => {
        bersihnoJobSesiWingi().catch(error => console.error('Processing job cleanup failed:', error));
    });
}

