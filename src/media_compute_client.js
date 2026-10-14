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

(() => {
    let nextId = 1;
    function run(operation, payload, transfer = [], onProgress = null) {
        const worker = new Worker(browser.runtime.getURL('media_compute_worker.js'));
        const id = nextId++;
        return new Promise((resolve, reject) => {
            worker.onmessage = event => {
                const data = event.data || {};
                if (data.type === 'progress') {
                    onProgress?.(data.value, data.operation);
                    return;
                }
                if (data.id !== id) return;
                worker.terminate();
                if (data.type === 'error') {
                    const error = new Error(data.message || 'Worker operation failed.');
                    if (data.stack) error.stack = data.stack;
                    reject(error);
                } else resolve(data.result);
            };
            worker.onerror = event => {
                worker.terminate();
                reject(new Error(event.message || 'Worker operation failed.'));
            };
            worker.postMessage({ id, operation, payload }, transfer);
        });
    }
    async function createZip(entries) {
        const normalized = entries.map(entry => ({
            name: entry.name,
            type: entry.input instanceof Blob ? entry.input.type : undefined,
            buffer: entry.input instanceof Blob ? entry.input : undefined,
            text: entry.input instanceof Blob ? undefined : String(entry.input ?? '')
        }));
        const output = await run('zip', { entries: normalized });
        return new Blob([output], { type: 'application/zip' });
    }
    globalThis.mediaCompute = { run, createZip };
})();
