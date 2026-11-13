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


const cleanVtt = (raw) => {
    let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!text.startsWith('WEBVTT')) text = 'WEBVTT\n\n' + text;
    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    const tsToSec = (ts) => {
        const p = ts.trim().split(':');
        if (p.length === 3) return +p[0]*3600 + +p[1]*60 + parseFloat(p[2]);
        return +p[0]*60 + parseFloat(p[1]);
    };
    const blocks = text.split(/\n\n+/);
    const header = blocks[0];
    const cueRe = /^([\d:.]+)\s+-->\s+([\d:.]+)/;
    const cues = [];
    for (let b = 1; b < blocks.length; b++) {
        const block = blocks[b].trim();
        if (!block) continue;
        const lines = block.split('\n');
        let ti = cueRe.test(lines[0]) ? 0 : 1;
        if (ti >= lines.length) continue;
        const m = lines[ti].match(/^([\d:.]+)\s+-->\s+([\d:.]+)/);
        if (!m) continue;
        const payload = lines.slice(ti+1).join('\n')
            .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '').replace(/<\/?c>/g, '')
            .replace(/<[^>]+>/g, '').trim();
        if (!payload) continue;
        cues.push({ s: tsToSec(m[1]), e: tsToSec(m[2]), t1: m[1], t2: m[2], p: payload });
    }
    const seen = new Map();
    for (const c of cues) seen.set(c.s, c);
    const sorted = Array.from(seen.values()).sort((a, b) => a.s - b.s);
    let maxE = 0;
    for (const c of sorted) {
        if (c.s < maxE) c.s = maxE;
        if (c.s >= c.e) c.e = c.s + 0.001;
        maxE = c.e;
    }
    if (!sorted.length) return null;
    const f2 = (n) => String(Math.floor(n)).padStart(2,'0');
    const toTs = (s) => `${f2(s/3600)}:${f2((s%3600)/60)}:${(s%60).toFixed(3).padStart(6,'0')}`;
    return header + '\n\n' + sorted.map((c,i) => `${i+1}\n${toTs(c.s)} --> ${toTs(c.e)}\n${c.p}`).join('\n\n');
};

const fetchUrlAsBlob = async (fetchUrl, statusEl, statusPrefix) => {
    const controller = new AbortController();
    try {
        let probeResp = await spoofedFetch(fetchUrl, { headers: { "Range": "bytes=0-0" }, signal: controller.signal });
        let isChunked = probeResp.status === 206;
        let size = 0;
        if (isChunked) {
            const cr = probeResp.headers.get('Content-Range');
            if (cr) {
                const match = cr.match(/\/(\d+)$/);
                if (match) size = parseInt(match[1], 10);
            }
        }
        if (!isChunked || !size) {
            const resp = await spoofedFetch(fetchUrl);
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            return await resp.blob();
        }
        const CHUNK_SIZE = 1024 * 1024;
        let chunks = [];
        let downloaded = 0;
        for (let start = 0; start < size; start += CHUNK_SIZE) {
            let end = Math.min(start + CHUNK_SIZE - 1, size - 1);
            let retries = 3;
            let chunkResp;
            while (retries > 0) {
                try {
                    chunkResp = await spoofedFetch(fetchUrl, { headers: { "Range": `bytes=${start}-${end}` } });
                    if (chunkResp.ok || chunkResp.status === 206) break;
                } catch (e) {
                    console.warn("Chunk fetch failed, retrying...", e);
                }
                retries--;
                if (retries === 0) throw new Error("Failed to fetch chunk " + start);
                await new Promise(r => setTimeout(r, 1000));
            }
            const arrayBuf = await chunkResp.arrayBuffer();
            chunks.push(new Uint8Array(arrayBuf));
            downloaded += arrayBuf.byteLength;
            if (statusEl) {
                const pct = Math.round((downloaded / size) * 100);
                statusEl.textContent = `${statusPrefix} (${pct}%)`;
            }
        }
        return new Blob(chunks);
    } catch (e) {
        console.error("fetchUrlAsBlob failed, trying fallback:", e);
        const resp = await spoofedFetch(fetchUrl);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return await resp.blob();
    }
};

function kumpulkanAudioUnik(ytFormats) {
    const trek = [];
    const sudahLihat = new Set();
    for (const fmt of ytFormats) {
        if (fmt.audioUrl && !sudahLihat.has(fmt.audioUrl)) {
            sudahLihat.add(fmt.audioUrl);
            trek.push({
                url: fmt.audioUrl,
                name: fmt.audioTrack?.displayName || fmt.audioTrack?.display_name || 'Default Audio',
                language: fmt.audioTrack?.language || fmt.audioTrack?.lang || 'und',
                isDefault: !!(fmt.audioTrack?.audioIsDefault || fmt.audioTrack?.audio_is_default)
            });
        }
    }
    return trek;
}

async function cobaDelegasiYoutube(konteks) {
    try {
        if (!konteks.bgDownloadEnabled) throw new Error('Background download disabled');
        const isYouTube = konteks.url.toLowerCase().includes('googlevideo.com') || konteks.url.toLowerCase().includes('youtube.com') || konteks.url.toLowerCase().includes('youtu.be') || (konteks.mediaDiv && konteks.mediaDiv.dataset.originalUrl && (konteks.mediaDiv.dataset.originalUrl.toLowerCase().includes('youtube.com') || konteks.mediaDiv.dataset.originalUrl.toLowerCase().includes('googlevideo.com') || konteks.mediaDiv.dataset.originalUrl.toLowerCase().includes('youtu.be')));
        if (!isYouTube) return false;
        const ytFormats = (konteks.mediaDiv && konteks.mediaDiv.ytFormats) || [];
        const allAudioTracks = kumpulkanAudioUnik(ytFormats);
        let delegatedAudioUrl = konteks.audioUrl;
        if (konteks.audioUrl === 'all' && konteks.muxAllAudios) {
            delegatedAudioUrl = allAudioTracks;
        } else if (konteks.audioUrl === 'all') {
            delegatedAudioUrl = (allAudioTracks.find(track => track.isDefault) || allAudioTracks[0])?.url || null;
        }
        const ytSubtitles = (konteks.mediaDiv && konteks.mediaDiv.ytSubtitles) || [];
        let delegatedSubtitles = [];
        if (konteks.subtitleUrl === 'all') delegatedSubtitles = ytSubtitles;
        else if (konteks.subtitleUrl && konteks.subtitleUrl !== 'none') {
            delegatedSubtitles = [ytSubtitles.find(track => track.vttUrl === konteks.subtitleUrl) || {
                vttUrl: konteks.subtitleUrl, displayName: 'Subtitle', language: 'und'
            }];
        }
        const embedSelectedSubtitles = konteks.embedSubtitlesMkv && delegatedSubtitles.length > 0;
        const zipYoutubeTracks = (!embedSelectedSubtitles && delegatedSubtitles.length > 0) || (konteks.audioUrl === 'all' && !konteks.muxAllAudios);
        const pesan = {
            action: 'startPersistentAudioJob',
            url: konteks.url,
            audioUrl: delegatedAudioUrl || null,
            youtubeTracks: {
                subtitles: delegatedSubtitles,
                audioFiles: konteks.audioUrl === 'all' && !konteks.muxAllAudios ? allAudioTracks : [],
                embedSubtitles: embedSelectedSubtitles,
                container: konteks.embedSubtitlesContainer,
                subtitleFormat: konteks.dlSettings['subtitle-conversion'] || 'none',
                zip: zipYoutubeTracks
            },
            filename: konteks.newName,
            isYouTube: true,
            audioOnly: false,
            request: konteks.targetRequest,
            downloadMethod: konteks.downloadMethod
        };
        if ('recoveryJobId' in konteks) pesan.recoveryJobId = konteks.recoveryJobId;
        const backgroundJob = await browser.runtime.sendMessage(pesan);
        if (!backgroundJob?.success) throw new Error(backgroundJob?.error || 'Unable to start background video job');
        if (backgroundJob.jobId && konteks.mediaDiv) {
            konteks.mediaDiv.dataset.downloadId = backgroundJob.jobId;
            const cachedItem = uiCache.get(konteks.downloadId) || uiCache.get(konteks.url);
            if (cachedItem) uiCache.set(backgroundJob.jobId, cachedItem);
        }
        if (typeof mdui !== 'undefined' && mdui.snackbar) {
            tampilnoNotif(browser.i18n.getMessage('downloadStarted') || 'Download started in background');
        }
        return true;
    } catch (err) {
        if (konteks.bgDownloadEnabled) console.warn("Failed to start persistent YouTube download, running in popup fallback:", err);
        return false;
    }
}
