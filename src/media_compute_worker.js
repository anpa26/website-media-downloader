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

const loadedLibraries = new Set();

function ensureLibraries(...paths) {
    const missing = paths.filter(path => !loadedLibraries.has(path));
    if (missing.length) {
        importScripts(...missing);
        missing.forEach(path => loadedLibraries.add(path));
    }
}

function postProgress(operation, value) {
    postMessage({ type: 'progress', operation, value });
}

async function transmuxTs(inputs) {
    ensureLibraries('libraries/mux.js', 'mp4_duration.js');
    const transmuxer = new muxjs.mp4.Transmuxer();
    const chunks = [];
    let finalizer = null;
    transmuxer.on('data', event => {
        if (event.initSegment && !finalizer) {
            finalizer = mp4Duration.createFinalizer(event.initSegment);
            chunks.push(finalizer.initSegment);
        }
        if (event.data) {
            finalizer?.addFragment(event.data);
            chunks.push(event.data);
        }
    });
    let processed = 0;
    const total = inputs.reduce((sum, input) => sum + Number(input?.size || input?.byteLength || 0), 0);
    for (const input of inputs) {
        const bytes = new Uint8Array(input instanceof Blob ? await input.arrayBuffer() : input);
        const chunkSize = 8 * 1024 * 1024 - ((8 * 1024 * 1024) % 188);
        for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
            const part = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
            transmuxer.push(part);
            transmuxer.flush();
            processed += part.byteLength;
            postProgress('transmux', total ? Math.min(99, processed / total * 100) : 0);
        }
    }
    transmuxer.flush();
    if (!chunks.length) return null;
    finalizer?.finish();
    const blob = new Blob(chunks, { type: 'video/mp4' });
    const buffer = await blob.arrayBuffer();
    postProgress('transmux', 100);
    return buffer;
}

function normalizeVtt(rawText) {
    let text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!text) return null;
    if (!/^WEBVTT(?:\s|$)/i.test(text)) {
        text = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }
    const cuePattern = /(?:^|\n)(?:[^\n]*\n)?((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})[^\n]*\n([\s\S]*?)(?=\n{2,}|$)/g;
    const toSeconds = value => {
        const parts = value.replace(',', '.').split(':').map(Number);
        return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    };
    const toTimestamp = value => {
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const seconds = (value % 60).toFixed(3).padStart(6, '0');
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds}`;
    };
    const byStart = new Map();
    let match;
    while ((match = cuePattern.exec(text))) {
        const start = toSeconds(match[1]);
        const end = toSeconds(match[2]);
        const payload = match[3].replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
            .replace(/<\/?c(?:\.[^>]*)?>/g, '').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
        if (Number.isFinite(start) && Number.isFinite(end) && end > start && payload) {
            byStart.set(start, { start, end, payload });
        }
    }
    const cues = Array.from(byStart.values()).sort((a, b) => a.start - b.start);
    if (!cues.length) return null;
    for (let index = 0; index < cues.length - 1; index++) {
        if (cues[index].end > cues[index + 1].start) cues[index].end = Math.max(cues[index].start + 0.001, cues[index + 1].start);
    }
    return 'WEBVTT\n\n' + cues.map((cue, index) =>
        `${index + 1}\n${toTimestamp(cue.start)} --> ${toTimestamp(cue.end)}\n${cue.payload}`
    ).join('\n\n') + '\n';
}

async function createZip(entries) {
    ensureLibraries('libraries/client-zip.js');
    const response = downloadZip(entries.map(entry => ({
        name: entry.name,
        input: entry.buffer instanceof Blob
            ? entry.buffer
            : entry.buffer
                ? new Blob([entry.buffer], { type: entry.type || 'application/octet-stream' })
                : entry.text
    })));
    return response.arrayBuffer();
}

function parseManifest(text, kind) {
    if (kind === 'm3u8') {
        const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
        const variants = [];
        for (let index = 0; index < lines.length; index++) {
            if (!lines[index].startsWith('#EXT-X-STREAM-INF')) continue;
            const bandwidth = Number(lines[index].match(/BANDWIDTH=(\d+)/i)?.[1] || 0);
            const resolution = lines[index].match(/RESOLUTION=(\d+x\d+)/i)?.[1] || 'unknown';
            const uri = lines[index + 1]?.trim();
            if (uri) variants.push({ bandwidth, resolution, uri });
        }
        return {
            lines,
            variants,
            segmentCount: lines.filter(line => line.trim() && !line.trim().startsWith('#')).length,
            duration: lines.reduce((sum, line) => {
                const match = line.trim().match(/^#EXTINF:([0-9.]+)/i);
                return sum + (match ? Number(match[1]) || 0 : 0);
            }, 0)
        };
    }
    const representationCount = (String(text || '').match(/<Representation\b/gi) || []).length;
    const segmentCount = (String(text || '').match(/<(?:S|SegmentURL)\b/gi) || []).length;
    return { representationCount, segmentCount };
}

self.onmessage = async event => {
    const { id, operation, payload } = event.data || {};
    try {
        let result;
        let transfer = [];
        if (operation === 'transmux') {
            result = await transmuxTs(payload.inputs || payload.buffers || []);
            if (result) transfer = [result];
        } else if (operation === 'zip') {
            result = await createZip(payload.entries || []);
            transfer = [result];
        } else if (operation === 'subtitle-normalize') {
            result = (payload.items || []).map(item => ({ ...item, text: normalizeVtt(item.text) })).filter(item => item.text);
        } else if (operation === 'subtitle-convert') {
            ensureLibraries('libraries/subsrt.bundle.js');
            result = subsrt.convert(payload.text, { format: payload.format });
        } else if (operation === 'manifest-parse') {
            result = parseManifest(payload.text, payload.kind);
        } else if (operation === 'media-sort') {
            const order = payload.order || 'newest';
            const compare = (a, b) => {
                if (order === 'oldest') return a.time - b.time;
                if (order === 'newest') return b.time - a.time;
                if (order === 'size_asc') return a.size - b.size;
                if (order === 'size_desc') return b.size - a.size;
                const aNumber = /^[0-9]/.test(a.name);
                const bNumber = /^[0-9]/.test(b.name);
                if (aNumber !== bNumber) return aNumber ? (order.startsWith('number') ? -1 : 1) : (order.startsWith('number') ? 1 : -1);
                const direction = order.endsWith('desc') ? -1 : 1;
                return a.name.localeCompare(b.name, undefined, order.startsWith('number')
                    ? { numeric: true, sensitivity: 'base' } : undefined) * direction;
            };
            result = (payload.items || []).map((item, index) => ({ ...item, index }))
                .sort((a, b) => compare(a, b) || a.index - b.index).map(item => item.index);
        } else {
            throw new Error(`Unknown compute operation: ${operation}`);
        }
        postMessage({ type: 'result', id, result }, transfer);
    } catch (error) {
        postMessage({ type: 'error', id, message: error?.message || String(error), stack: error?.stack || '' });
    }
};
