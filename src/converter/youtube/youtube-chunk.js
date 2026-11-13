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


window.fetchAsUint8ArrayChunked = async (url, loadingBar, statusInfo, onCancel, onPause) => {
    let totalSize = 0;
    let totalDownloaded = 0;
    const CHUNK_SIZE = 5 * 1024 * 1024;

    const controller = new AbortController();
    if (window.activeAbortControllers) window.activeAbortControllers.set(url, controller);

    const checkPause = async (reader = null) => {
        let firstPaused = true;
        while (onPause ? onPause() : (window.activePauses && window.activePauses.has(url))) {
            if (firstPaused) {
                firstPaused = false;
                updateProgressStatus(loadingBar, totalDownloaded, totalSize, statusInfo, url);
            }
            if (onCancel && onCancel()) {
                if (reader) {
                    try { reader.cancel(); } catch(e) {}
                }
                throw new Error("Cancelled");
            }
            await new Promise(r => setTimeout(r, 200));
        }
        if (!firstPaused) {
            updateProgressStatus(loadingBar, totalDownloaded, totalSize, statusInfo, url);
        }
    };

    try {
        let probeResp = await spoofedFetch(url, { headers: { "Range": "bytes=0-0" }, signal: controller.signal });
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
            const resp = await spoofedFetch(url, { signal: controller.signal });
            if (!resp.ok) throw new Error("Failed to fetch " + url);

            size = +(resp.headers.get('Content-Length') || 0);
            totalSize = size;

            const reader = resp.body.getReader();
            let chunks = [];
            let downloaded = 0;

            while (true) {
                await checkPause(reader);
                if (onCancel && onCancel()) {
                    reader.cancel();
                    throw new Error("Cancelled");
                }
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
                downloaded += value.length;
                totalDownloaded += value.length;

                if (loadingBar && totalSize > 0) {
                    loadingBar.removeAttribute('indeterminate');
                    loadingBar.max = 100;
                    updateProgressStatus(loadingBar, totalDownloaded, totalSize, statusInfo, url);
                }
            }

            let pos = 0;
            let result = new Uint8Array(downloaded);
            for(let chunk of chunks) {
                result.set(chunk, pos);
                pos += chunk.length;
            }
            return result;
        }

        totalSize = size;
        let result = new Uint8Array(size);

        for (let start = 0; start < size; start += CHUNK_SIZE) {
            await checkPause();
            if (onCancel && onCancel()) {
                throw new Error("Cancelled");
            }
            let end = Math.min(start + CHUNK_SIZE - 1, size - 1);

            let chunkResp;
            let retries = 3;
            while (retries > 0) {
                try {
                    chunkResp = await spoofedFetch(url, { headers: { "Range": `bytes=${start}-${end}` }, signal: controller.signal });
                    if (chunkResp.ok || chunkResp.status === 206) break;
                } catch (e) {
                    if (e.name === 'AbortError' || (onCancel && onCancel())) throw new Error("Cancelled");
                    console.warn("Chunk fetch failed, retrying...", e);
                }
                retries--;
                if (retries === 0) throw new Error("Failed to fetch chunk " + start);
                await new Promise(r => setTimeout(r, 1500));
            }

            const arrayBuf = await chunkResp.arrayBuffer();
            const chunkData = new Uint8Array(arrayBuf);

            result.set(chunkData, start);
            totalDownloaded += chunkData.length;

            if (loadingBar && totalSize > 0) {
                loadingBar.removeAttribute('indeterminate');
                loadingBar.max = 100;
                updateProgressStatus(loadingBar, totalDownloaded, totalSize, statusInfo, url);
            }
        }
        return result;
    } catch (e) {
        if (e.name === 'AbortError') throw new Error("Cancelled");
        throw e;
    } finally {
        if (window.activeAbortControllers) window.activeAbortControllers.delete(url);
    }
};
