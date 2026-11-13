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


async function embedSubtitlesWithLibAV(videoBlob, subData, containerFormat, filename, downloadMethod, loadingBar, returnBlob = false) {
    console.log("embedSubtitlesWithLibAV: Starting...");
    const statusInfo = loadingBar ? loadingBar.parentNode.querySelector('.download-status-info') : null;
    if (statusInfo) statusInfo.textContent = "Initializing LibAV...";
    if (loadingBar) loadingBar.setAttribute('indeterminate', 'true');

    let libav = null;
    let ffmpegLog = "";
    const origLog = console.log;
    const origErr = console.error;

    try {
        console.log("embedSubtitlesWithLibAV: Selecting LibAV variant...");
        const isMp4 = containerFormat === 'mp4';
        const libavVar = isMp4 ? 'LibAV_h264' : 'LibAV';
        const libavScript = 'libraries/libav.js';

        if (!window[libavVar] || !window[libavVar].LibAV) {
            console.log("embedSubtitlesWithLibAV: Loading script " + libavScript);
            const script = document.createElement('script');
            script.src = browser.runtime.getURL(libavScript);
            document.head.appendChild(script);
            await new Promise(resolve => {
                script.onload = () => {
                    console.log("embedSubtitlesWithLibAV: Script loaded: " + libavScript);
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

        console.log("embedSubtitlesWithLibAV: Initializing LibAV instance...");
        libav = await window[libavVar].LibAV({
            noworker: false,
            base: browser.runtime.getURL('libraries'),
            toImport: browser.runtime.getURL('libraries/libav.js')
        });
        console.log("embedSubtitlesWithLibAV: LibAV instance ready.");

        if (statusInfo) statusInfo.textContent = "Reading video data...";
        const videoBuf = await videoBlob.arrayBuffer();
        const videoData = new Uint8Array(videoBuf);

        const videoFile = 'input_video' + (isMp4 ? '.mp4' : '.mkv');
        const outputFile = 'output' + (isMp4 ? '.mp4' : '.mkv');

        await libav.writeFile(videoFile, videoData);

        const ffmpegArgs = ["-y", "-i", videoFile];

        const normalizedSubData = globalThis.mediaCompute?.run
            ? await globalThis.mediaCompute.run('subtitle-normalize', { items: subData })
            : subData.map(item => ({ ...item, text: normalizeVttForMux(item.text) })).filter(item => item.text);
        if (!normalizedSubData.length) throw new Error('No valid subtitle cues to embed');

        for (let i = 0; i < normalizedSubData.length; i++) {
            const subFile = `sub_${i}.vtt`;
            const subEncoder = new TextEncoder();
            const subBytes = subEncoder.encode(normalizedSubData[i].text);
            await libav.writeFile(subFile, subBytes);
            ffmpegArgs.push("-i", subFile);
        }

        ffmpegArgs.push("-map", "0");
        for (let i = 0; i < normalizedSubData.length; i++) {
            ffmpegArgs.push("-map", `${i + 1}`);
        }

        ffmpegArgs.push("-c:v", "copy", "-c:a", "copy");
        if (isMp4) {
            ffmpegArgs.push("-c:s", "mov_text");
        } else {
            ffmpegArgs.push("-c:s", "srt");
        }

        const toIso3 = (lang) => {
            const map = { en:'eng', id:'ind', ja:'jpn', ko:'kor', zh:'zho', fr:'fra', de:'deu',
                          es:'spa', pt:'por', ru:'rus', ar:'ara', hi:'hin', tr:'tur', it:'ita',
                          nl:'nld', pl:'pol', th:'tha', vi:'vie', sv:'swe', fi:'fin', da:'dan',
                          no:'nor', cs:'ces', sk:'slk', ro:'ron', hu:'hun', el:'ell', uk:'ukr' };
            if (!lang) return 'und';
            const base = lang.split('-')[0].toLowerCase();
            if (base.length === 3) return base;
            return map[base] || 'und';
        };

        for (let i = 0; i < normalizedSubData.length; i++) {
            const lang = toIso3(normalizedSubData[i].language);
            const name = normalizedSubData[i].displayName || `Subtitle ${i+1}`;
            ffmpegArgs.push(`-metadata:s:s:${i}`, `language=${lang}`);
            if (lang === 'und') ffmpegArgs.push(`-metadata:s:s:${i}`, `title=${name}`);
        }

        // YouTube captions can contain a final cue with an invalid/open-ended
        // duration. Never let that subtitle extend muxing past the media input.
        ffmpegArgs.push("-shortest", outputFile);

        if (statusInfo) statusInfo.textContent = "Embedding subtitles with LibAV...";
        const exitCode = await libav.ffmpeg(ffmpegArgs);
        console.log("LibAV ffmpeg exit code:", exitCode);

        let data;
        try {
            data = await libav.readFile(outputFile);
        } catch (readErr) {
            throw new Error("Embedding subtitles failed. Output file not created. Exit code: " + exitCode);
        }

        const mimeType = isMp4 ? 'video/mp4' : 'video/x-matroska';
        const blob = new Blob([data.buffer], { type: mimeType });

        const finalFilename = filename.replace(/\.[^/.]+$/, "") + (isMp4 ? '.mp4' : '.mkv');

        if (returnBlob) return blob;

        if (typeof finalizeDownload === 'function') {
            await finalizeDownload(blob, finalFilename, downloadMethod, loadingBar, false, false);
        } else {
            const finalBlobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = finalBlobUrl;
            a.download = finalFilename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(finalBlobUrl); }, 2000);
        }
    } catch (e) {
        console.error("FFmpeg subtitle embedding failed:", e);
        if (typeof alert === 'function') alert("FFmpeg Error: " + (e.stack || e.message || e) + "\n\nFFmpeg Log:\n" + ffmpegLog);
        throw e;
    } finally {
        console.log = origLog;
        console.error = origErr;
        if (libav) {
            try {
                const terminatePromise = libav.terminate();
                await Promise.race([
                    terminatePromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error("LibAV terminate timeout")), 2000))
                ]);
                console.log("embedSubtitlesWithLibAV: LibAV instance terminated.");
            } catch (te) {
                console.warn("embedSubtitlesWithLibAV: Failed to terminate LibAV instance:", te);
            }
        }
    }
}
