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



function setupManualTsConverter() {
    const fileInput = document.getElementById('manual-ts-file');
    const selectButton = document.getElementById('manual-ts-select');
    const convertButton = document.getElementById('manual-ts-convert');
    const filenameLabel = document.getElementById('manual-ts-filename');
    const progress = document.getElementById('manual-ts-progress');
    const status = document.getElementById('manual-ts-status');
    if (!fileInput || !selectButton || !convertButton || !filenameLabel || !progress || !status || selectButton.dataset.ready === '1') return;
    selectButton.dataset.ready = '1';

    const message = (key, fallback, substitutions) => browser.i18n.getMessage(key, substitutions) || fallback;
    selectButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        let file = fileInput.files?.[0];
        if (file && !/\.ts$/i.test(file.name)) {
            fileInput.value = '';
            file = null;
            status.style.display = 'block';
            status.textContent = message('manualTsInvalidFileType', 'Only .ts files can be selected.');
        }
        filenameLabel.textContent = file?.name || message('manualTsNoFile', 'No file selected');
        convertButton.disabled = !file;
        progress.value = 0;
        progress.style.display = 'none';
        status.style.display = 'none';
    });

    convertButton.addEventListener('click', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        selectButton.disabled = true;
        convertButton.disabled = true;
        const convertLabel = convertButton.textContent;
        convertButton.textContent = '';
        convertButton.loading = true;
        progress.value = 0;
        progress.style.display = 'block';
        status.style.display = 'block';
        status.textContent = message('manualTsConverting', 'Converting to MP4…');
        try {
            const result = await transmuxToMp4([file], percent => {
                const value = Math.max(0, Math.min(100, Number(percent) || 0));
                progress.value = value;
                status.textContent = message('manualTsConvertingProgress', 'Converting to MP4: $1%', [String(Math.round(value))]);
            });
            if (result.ext !== '.mp4' || !result.blob?.size) throw new Error(message('manualTsInvalidFile', 'The selected file could not be converted to MP4.'));
            const outputName = file.name.replace(/\.ts$/i, '') + '.mp4';
            const objectUrl = URL.createObjectURL(result.blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = outputName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
            progress.value = 100;
            status.textContent = message('manualTsComplete', 'Conversion complete. Saving MP4…');
        } catch (error) {
            console.error('Manual TS conversion failed:', error);
            status.textContent = message('manualTsFailed', 'Conversion failed: $1', [error?.message || String(error)]);
        } finally {
            selectButton.disabled = false;
            convertButton.disabled = !fileInput.files?.[0];
            convertButton.loading = false;
            convertButton.textContent = convertLabel;
        }
    });
}
