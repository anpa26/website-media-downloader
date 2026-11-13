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


async function downloadAndMuxYoutube(videoUrl, audioUrl, filename, downloadMethod, loadingBar, returnBlob = false) {
    console.log("downloadAndMuxYoutube: Starting...");
    const statusInfo = loadingBar ? loadingBar.parentNode.querySelector('.download-status-info') : null;
    if (statusInfo) statusInfo.textContent = "Initializing...";
    if (loadingBar) loadingBar.setAttribute('indeterminate', 'true');

    // Clear any previous cancellation for these specific URLs to allow retry
    if (window.activeCancellations) {
        window.activeCancellations.delete(videoUrl);
        window.activeCancellations.delete(audioUrl);
    }

    let libav = null;
    let ffmpegLog = "";
    const origLog = console.log;
    const origErr = console.error;

    try {
        console.log("downloadAndMuxYoutube: Selecting LibAV variant...");
        const isMp4 = filename.toLowerCase().includes('.mp4');
        const libavVar = isMp4 ? 'LibAV_h264' : 'LibAV';
        const libavScript = 'libraries/libav.js';

        if (!window[libavVar] || !window[libavVar].LibAV) {
            console.log("downloadAndMuxYoutube: Loading script " + libavScript);
            const script = document.createElement('script');
            script.src = browser.runtime.getURL(libavScript);
            document.head.appendChild(script);
            await new Promise(resolve => {
                script.onload = () => {
                    console.log("downloadAndMuxYoutube: Script loaded: " + libavScript);
                    resolve();
                };
            });
        }

        console.log = function(...args) {
            ffmpegLog += args.join(" ") + "\n";
            origLog.apply(console, args);
        };
        console.error = function(...args) {
            ffmpegLog += args.join(" ") + "\n";
            origErr.apply(console, args);
        };

        console.log("downloadAndMuxYoutube: Initializing LibAV instance...");
        libav = await window[libavVar].LibAV({
            noworker: false,
            base: browser.runtime.getURL('libraries'),
            toImport: browser.runtime.getURL('libraries/libav.js')
        });
        console.log("downloadAndMuxYoutube: LibAV instance ready.");

        let totalSize = 0;
        let totalDownloaded = 0;
        let speedMBps = 0;
        let startTime = Date.now();
        const updateSharedProgress = () => {
            if (!loadingBar || !totalSize || !statusInfo) return;
            loadingBar.removeAttribute('indeterminate');
            loadingBar.max = 100;
            loadingBar.value = Math.round((totalDownloaded / totalSize) * 100);

            const percent = Math.round((totalDownloaded / totalSize) * 100);
            const loadedMB = (totalDownloaded / 1048576).toFixed(1);
            const totalMB = (totalSize / 1048576).toFixed(1);

            const elapsedSeconds = (Date.now() - startTime) / 1000;
            speedMBps = elapsedSeconds > 0 ? ((totalDownloaded / 1048576) / elapsedSeconds).toFixed(1) : 0;

            const isPaused = window.activePauses && (window.activePauses.has(videoUrl) || window.activePauses.has(audioUrl));
            const statusPrefix = isPaused ? `[${browser.i18n.getMessage("pausedStatus") || "Paused"}] ` : "Downloading: ";
            const speedStr = isPaused ? "" : ` - ${speedMBps} MB/s`;

            statusInfo.textContent = `${statusPrefix}${percent}% (${loadedMB}MB / ${totalMB}MB)${speedStr}`;
        };

        const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks to bypass throttle

        const fetchAsUint8Array = async (url) => {
            const checkCancel = () => {
                if (window.activeCancellations) {
                    if (window.activeCancellations.has(videoUrl) || window.activeCancellations.has(audioUrl) || window.activeCancellations.has(url)) {
                        return true;
                    }
                }
                return false;
            };

            const checkPause = async (reader = null) => {
                let firstPaused = true;
                while (window.activePauses && (window.activePauses.has(videoUrl) || window.activePauses.has(audioUrl) || window.activePauses.has(url))) {
                    if (firstPaused) {
                        firstPaused = false;
                        updateSharedProgress();
                    }
                    if (checkCancel()) {
                        if (reader) {
                            try { reader.cancel(); } catch(e) {}
                        }
                        throw new Error("Cancelled");
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
                if (!firstPaused) {
                    startTime = Date.now() - (totalDownloaded / (1048576 * (parseFloat(speedMBps) || 1))) * 1000;
                    updateSharedProgress();
                }
            };

            if (checkCancel()) throw new Error("Cancelled");

            const controller = new AbortController();
            if (window.activeAbortControllers) window.activeAbortControllers.set(url, controller);

            try {
                // Probe size using Range request
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
                    // Fallback to slow linear fetch if server rejects Range
                    const resp = await spoofedFetch(url, { signal: controller.signal });
                    if (!resp.ok) throw new Error("Failed to fetch " + url);

                    size = +(resp.headers.get('Content-Length') || 0);
                    totalSize += size;

                    const reader = resp.body.getReader();
                    let chunks = [];
                    let downloaded = 0;

                    while (true) {
                        await checkPause(reader);
                        if (checkCancel()) {
                            try { reader.cancel(); } catch(e) {}
                            throw new Error("Cancelled");
                        }
                        const {done, value} = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        downloaded += value.length;
                        totalDownloaded += value.length;
                        if (loadingBar && totalSize > 0) {
                            updateSharedProgress();
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

                // Chunked fast fetch
                totalSize += size;
                let result = new Uint8Array(size);

                for (let start = 0; start < size; start += CHUNK_SIZE) {
                    await checkPause();
                    if (checkCancel()) throw new Error("Cancelled");
                    let end = Math.min(start + CHUNK_SIZE - 1, size - 1);

                    let chunkResp;
                    let retries = 3;
                    while (retries > 0) {
                        try {
                            chunkResp = await spoofedFetch(url, { headers: { "Range": `bytes=${start}-${end}` }, signal: controller.signal });
                            if (chunkResp.ok || chunkResp.status === 206) break;
                        } catch (e) {
                            if (e.name === 'AbortError' || checkCancel()) throw new Error("Cancelled");
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
                        updateSharedProgress();
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

        console.log("downloadAndMuxYoutube: Fetching video and audio data...");
        const isMultiAudio = Array.isArray(audioUrl);
        let videoData;
        let audioDatas = [];

        if (isMultiAudio) {
            videoData = await fetchAsUint8Array(videoUrl);
            console.log("downloadAndMuxYoutube: Video data fetched (" + videoData.length + " bytes)");
            for (let i = 0; i < audioUrl.length; i++) {
                if (statusInfo) statusInfo.textContent = `Fetching audio ${i+1}/${audioUrl.length}: ${audioUrl[i].name}...`;
                const data = await fetchAsUint8Array(audioUrl[i].url);
                console.log(`downloadAndMuxYoutube: Audio data ${i+1} fetched (${data.length} bytes)`);
                audioDatas.push({ data: data, url: audioUrl[i].url, name: audioUrl[i].name, language: audioUrl[i].language, isDefault: audioUrl[i].isDefault });
            }
        } else {
            const [vData, aData] = await Promise.all([
                fetchAsUint8Array(videoUrl).then(data => {
                    console.log("downloadAndMuxYoutube: Video data fetched (" + data.length + " bytes)");
                    return data;
                }),
                fetchAsUint8Array(audioUrl).then(data => {
                    console.log("downloadAndMuxYoutube: Audio data fetched (" + data.length + " bytes)");
                    return data;
                })
            ]);
            videoData = vData;
            audioDatas.push({ data: aData, url: audioUrl, name: "Default Audio" });
        }

        console.log("downloadAndMuxYoutube: Data fetch complete. Starting muxing...");

        if (loadingBar) {
            loadingBar.removeAttribute('value');
            loadingBar.setAttribute('indeterminate', 'true');
        }
        if (statusInfo) statusInfo.textContent = "Muxing... 0%";

        let durationSeconds = 0;
        libav.onwrite = (name, pos, data) => {
            const str = new TextDecoder().decode(data);

            // Extract total duration
            if (str.includes("Duration: ")) {
                const match = str.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
                if (match) {
                    durationSeconds = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseFloat(match[3]);
                }
            }

            // Extract current time progress
            if (str.includes("time=")) {
                const match = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
                if (match && durationSeconds > 0) {
                    const timeSeconds = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseFloat(match[3]);
                    let progress = Math.round((timeSeconds / durationSeconds) * 100);
                    if (progress > 100) progress = 100;

                    if (statusInfo) statusInfo.textContent = `Muxing... ${progress}%`;
                    if (loadingBar) {
                        loadingBar.removeAttribute('indeterminate');
                        loadingBar.max = 100;
                        loadingBar.value = progress;
                    }
                }
            }
        };

        // Detect actual container format from URL mime parameter
        function getExtFromUrl(url) {
            try {
                const u = new URL(url);
                const mime = u.searchParams.get('mime') || '';
                if (mime.includes('webm')) return '.webm';
                if (mime.includes('mp4')) return '.mp4';
                if (mime.includes('3gpp')) return '.3gp';
            } catch(e) {}
            // Fallback: guess from URL path
            if (url.includes('webm')) return '.webm';
            if (url.includes('mp4')) return '.mp4';
            return '.mkv'; // universal fallback
        }

        const videoExt = getExtFromUrl(videoUrl);
        const videoFile = 'input_video' + videoExt;
        const targetExt = '.mp4';
        const outputFile = 'output' + targetExt;

        console.log("LibAV: videoExt=" + videoExt + ", output=" + outputFile);

        await libav.writeFile(videoFile, videoData);

        const ffmpegArgs = ["-y", "-i", videoFile];
        const audioFiles = [];

        for (let i = 0; i < audioDatas.length; i++) {
            const audioExt = getExtFromUrl(audioDatas[i].url);
            const audioFile = `input_audio_${i}` + audioExt;
            await libav.writeFile(audioFile, audioDatas[i].data);
            audioFiles.push(audioFile);
            ffmpegArgs.push("-i", audioFile);
        }

        ffmpegArgs.push("-map", "0:v:0");
        for (let i = 0; i < audioFiles.length; i++) {
            ffmpegArgs.push("-map", `${i + 1}:a:0`);
        }

        ffmpegArgs.push("-c:v", "copy", "-c:a", "copy");

        if (isMultiAudio) {
            const audioLanguage = value => {
                const map = { en:'eng', id:'ind', ja:'jpn', ko:'kor', zh:'zho', fr:'fra', de:'deu', es:'spa', pt:'por', ru:'rus', ar:'ara', hi:'hin', tr:'tur', it:'ita', nl:'nld', pl:'pol', th:'tha', vi:'vie' };
                const base = String(value || '').split(/[-_.]/)[0].toLowerCase();
                return base.length === 3 ? base : (map[base] || 'und');
            };
            for (let i = 0; i < audioDatas.length; i++) {
                const trackName = audioDatas[i].name || `Audio ${i + 1}`;
                ffmpegArgs.push(`-metadata:s:a:${i}`, `title=${trackName}`);
                ffmpegArgs.push(`-metadata:s:a:${i}`, `handler_name=${trackName}`);
                ffmpegArgs.push(`-metadata:s:a:${i}`, `language=${audioLanguage(audioDatas[i].language)}`);
                ffmpegArgs.push(`-disposition:a:${i}`, audioDatas[i].isDefault || (!audioDatas.some(track => track.isDefault) && i === 0) ? 'default' : '0');
            }
        }

        ffmpegArgs.push(outputFile);

        const exitCode = await libav.ffmpeg(ffmpegArgs);

        console.log("LibAV ffmpeg exit code:", exitCode);

        // Try to read the output - if ffmpeg failed, show the log
        let data;
        try {
            data = await libav.readFile(outputFile);
        } catch (readErr) {
            throw new Error("Muxing failed: " + outputFile + " not created. Exit code: " + exitCode);
        }

        const mimeType = targetExt.includes('mp4') ? 'video/mp4' : 'video/x-matroska';
        const blob = new Blob([data.buffer], { type: mimeType });

        // Use the video title as filename
        const finalFilename = filename.replace(/\.[^/.]+$/, "") + targetExt;

        if (returnBlob) {
            return blob;
        }
        await finalizeDownload(blob, finalFilename, downloadMethod, loadingBar, false, false);
    } catch (e) {
        if (e.message === "Cancelled") {
            console.log("Download cancelled by user.");
            if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("downloadCancelled") || "Download cancelled";
        } else {
            console.error("FFmpeg muxing failed:", e);
            alert("FFmpeg Error: " + (e.stack || e.message || e) + "\n\nFFmpeg Log:\n" + (typeof ffmpegLog !== 'undefined' ? ffmpegLog.substring(ffmpegLog.length - 1500) : ''));
        }
        throw e;
    } finally {
        console.log("downloadAndMuxYoutube: Cleaning up...");
        console.log = origLog;
        console.error = origErr;
        if (libav) {
            try {
                // Use a timeout for terminate to avoid hanging forever
                if (typeof libav.terminate === 'function') {
                    const terminatePromise = libav.terminate();
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("LibAV terminate timeout")), 2000)
                    );
                    await Promise.race([terminatePromise, timeoutPromise]);
                } else {
                    console.log("downloadAndMuxYoutube: libav.terminate is not a function, skipping.");
                }
                console.log("downloadAndMuxYoutube: LibAV instance terminated.");
            } catch (te) {
                console.warn("downloadAndMuxYoutube: Failed to terminate LibAV instance:", te);
            }
        }
        console.log("downloadAndMuxYoutube: Implementation finished.");
    }
}
