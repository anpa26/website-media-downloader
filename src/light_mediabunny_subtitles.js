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
    const statusInfo = loadingBar?.parentNode?.querySelector('.download-status-info') || null;
    const subtitles = (subData || [])
        .map(item => ({ ...item, text: normalizeVttForMux(item.text) }))
        .filter(item => item.text);
    if (!subtitles.length) throw new Error('No valid subtitle cues to embed.');

    if (loadingBar) {
        loadingBar.removeAttribute('indeterminate');
        loadingBar.max = 100;
        loadingBar.value = 0;
    }
    if (statusInfo) statusInfo.textContent = 'Preparing subtitle tracks...';

    const videoBuffer = await videoBlob.arrayBuffer();
    const buffer = await runLightMediabunnyWorker({
        type: 'embed', videoBuffer, subtitles
    }, [videoBuffer], percent => {
        if (loadingBar) loadingBar.value = percent;
        if (statusInfo) statusInfo.textContent = `Embedding subtitles... ${percent}%`;
    });

    const blob = new Blob([buffer], { type: 'video/mp4' });
    if (returnBlob) return blob;
    const finalFilename = filename.replace(/\.[^/.]+$/, '') + '.mp4';
    await finalizeDownload(blob, finalFilename, downloadMethod, loadingBar, false, false);
}
