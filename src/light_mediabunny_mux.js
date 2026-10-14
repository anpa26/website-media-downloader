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

async function runLightMediabunnyWorker(message, transfer, onProgress, isCancelled) {
    const worker = new Worker(browser.runtime.getURL('light_mediabunny_worker.js'));
    let cancelTimer = null;
    try {
        return await new Promise((resolve, reject) => {
            worker.onmessage = event => {
                const data = event.data || {};
                if (data.type === 'progress') onProgress?.(data.percent);
                else if (data.type === 'result') resolve(data.buffer);
                else if (data.type === 'error') {
                    const error = new Error(data.message || 'Mediabunny worker failed.');
                    if (data.stack) error.stack = data.stack;
                    reject(error);
                }
            };
            worker.onerror = event => reject(new Error(event.message || 'Mediabunny worker failed.'));
            if (isCancelled) {
                cancelTimer = setInterval(() => {
                    if (isCancelled()) {
                        worker.postMessage({ type: 'cancel' });
                        reject(new Error('Cancelled'));
                    }
                }, 150);
            }
            worker.postMessage(message, transfer);
        });
    } finally {
        if (cancelTimer) clearInterval(cancelTimer);
        worker.terminate();
    }
}

async function downloadAndMuxYoutube(videoUrl, audioUrl, filename, downloadMethod, loadingBar, returnBlob = false, subtitleData = []) {
    const statusInfo = loadingBar?.parentNode?.querySelector('.download-status-info') || null;
    const audioSourceUrl = Array.isArray(audioUrl) ? audioUrl[0]?.url : audioUrl;
    if (!audioSourceUrl) throw new Error('No audio stream was provided.');

    if (window.activeCancellations) {
        window.activeCancellations.delete(videoUrl);
        window.activeCancellations.delete(audioSourceUrl);
    }
    const isCancelled = () => window.activeCancellations?.has(videoUrl)
        || window.activeCancellations?.has(audioSourceUrl);
    const isPaused = () => window.activePauses?.has(videoUrl)
        || window.activePauses?.has(audioSourceUrl);

    try {
        if (Array.isArray(audioUrl) && audioUrl.length > 1) {
            throw new Error('Multiple audio tracks are not supported in the Light edition.');
        }
        const subtitles = (subtitleData || [])
            .map(item => ({ ...item, text: normalizeVttForMux(item.text) }))
            .filter(item => item.text);

        if (loadingBar) loadingBar.setAttribute('indeterminate', 'true');
        if (statusInfo) statusInfo.textContent = subtitles.length
            ? 'Downloading video, audio, and subtitles...'
            : 'Downloading video and audio...';
        const [videoData, audioData] = await Promise.all([
            window.fetchAsUint8ArrayChunked(videoUrl, loadingBar, statusInfo, isCancelled, isPaused),
            window.fetchAsUint8ArrayChunked(audioSourceUrl, loadingBar, statusInfo, isCancelled, isPaused)
        ]);
        if (isCancelled()) throw new Error('Cancelled');

        if (loadingBar) {
            loadingBar.removeAttribute('indeterminate');
            loadingBar.max = 100;
            loadingBar.value = 0;
        }
        const buffer = await runLightMediabunnyWorker({
            type: 'mux', videoBuffer: videoData.buffer, audioBuffer: audioData.buffer, subtitles
        }, [videoData.buffer, audioData.buffer], percent => {
            if (loadingBar) loadingBar.value = percent;
            if (statusInfo) statusInfo.textContent = `${subtitles.length ? 'Muxing with subtitles' : 'Muxing'}... ${percent}%`;
        }, isCancelled);

        const blob = new Blob([buffer], { type: 'video/mp4' });
        if (returnBlob) return blob;
        const finalFilename = filename.replace(/\.[^/.]+$/, '') + '.mp4';
        await finalizeDownload(blob, finalFilename, downloadMethod, loadingBar, false, false);
    } catch (error) {
        if (error.message === 'Cancelled') {
            if (statusInfo) statusInfo.textContent = browser.i18n.getMessage('downloadCancelled') || 'Download cancelled';
        } else {
            console.error('Mediabunny muxing failed:', error);
            alert('Muxing Error: ' + (error.stack || error.message || error));
        }
        throw error;
    }
}

downloadAndMuxYoutube.supportsInlineSubtitles = true;
