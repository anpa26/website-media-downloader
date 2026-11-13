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



async function gabungkanVideoAudioKeMp4(vBlob, aBlob, extVideo, extAudio) {
    let libavInstance = null;
    let logFfmpeg = "";
    const logAsli = console.log;
    const errAsli = console.error;
    const tebakExt = async (blob, jatuh) => {
        try {
            const awal = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
            if (awal[0] === 0x47) return '.ts';
            const hex = Array.from(awal).map(b => b.toString(16).padStart(2, '0')).join('');
            if (hex.includes('66747970') || hex.includes('73747970')) return '.mp4';
            if (awal[0] === 0xFF && (awal[1] & 0xF6) === 0xF0) return '.aac';
            if (awal[0] === 0xFF && (awal[1] & 0xE0) === 0xE0) return '.mp3';
            if (awal[0] === 0x49 && awal[1] === 0x44 && awal[2] === 0x33) return '.mp3';
        } catch (e) {}
        return jatuh || '.mp4';
    };
    try {
        console.log = function(...args) {
            logFfmpeg += args.join(" ") + "\n";
            logAsli.apply(console, args);
        };
        console.error = function(...args) {
            logFfmpeg += args.join(" ") + "\n";
            errAsli.apply(console, args);
        };
        const libavVar = 'LibAV_h264';
        const libavScript = 'libraries/libav.js';

        if (!window[libavVar] || !window[libavVar].LibAV) {
            const script = document.createElement('script');
            script.src = browser.runtime.getURL(libavScript);
            document.head.appendChild(script);
            await new Promise(resolve => {
                script.onload = () => resolve();
            });
        }

        libavInstance = await window[libavVar].LibAV({
            noworker: false,
            base: browser.runtime.getURL('libraries'),
            toImport: browser.runtime.getURL('libraries/libav.js')
        });

        const berkasVideo = 'input_video' + (vBlob ? await tebakExt(vBlob, extVideo) : (extVideo || '.mp4'));
        const berkasAudio = 'input_audio' + (aBlob ? await tebakExt(aBlob, extAudio) : (extAudio || '.mp4'));
        if (vBlob) {
            await libavInstance.writeFile(berkasVideo, new Uint8Array(await vBlob.arrayBuffer()));
        }
        if (aBlob) {
            await libavInstance.writeFile(berkasAudio, new Uint8Array(await aBlob.arrayBuffer()));
        }

        const ffmpegArgs = ["-y"];
        if (vBlob) ffmpegArgs.push("-i", berkasVideo);
        if (aBlob) ffmpegArgs.push("-i", berkasAudio);

        if (vBlob && aBlob) {
            ffmpegArgs.push("-c:v", "copy", "-c:a", "copy", "output.mp4");
        } else if (vBlob) {
            ffmpegArgs.push("-c:v", "copy", "output.mp4");
        } else if (aBlob) {
            ffmpegArgs.push("-c:a", "copy", "output.mp4");
        }

        const exitCode = await libavInstance.ffmpeg(ffmpegArgs);
        console.log("gabungkanVideoAudioKeMp4 LibAV ffmpeg exit code:", exitCode);

        let outputData;
        try {
            outputData = await libavInstance.readFile("output.mp4");
        } catch (readErr) {
            throw new Error("Muxing failed: output.mp4 not created. Exit code: " + exitCode);
        }

        return new Blob([outputData.buffer], { type: 'video/mp4' });
    } catch (e) {
        const infoBlob = "Video: " + (vBlob ? vBlob.size : 0) + " bytes (" + (extVideo || '?') + "), Audio: " + (aBlob ? aBlob.size : 0) + " bytes (" + (extAudio || '?') + ")";
        alert("FFmpeg Error: " + (e.message || e) + "\n" + infoBlob + "\n\nFFmpeg Log:\n" + logFfmpeg.substring(logFfmpeg.length - 3000));
        throw e;
    } finally {
        console.log = logAsli;
        console.error = errAsli;
        if (libavInstance) {
            try {
                await libavInstance.terminate();
            } catch (e) {
                console.warn("gabungkanVideoAudioKeMp4: Failed to terminate LibAV:", e);
            }
        }
    }
}
