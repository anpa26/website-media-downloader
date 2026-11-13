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


// Helper for statusInfo

function normalizeVttForMux(rawText) {
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
        const payload = match[3]
            .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
            .replace(/<\/?c(?:\.[^>]*)?>/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{2,}/g, '\n').trim();
        if (Number.isFinite(start) && Number.isFinite(end) && end > start && payload) {
            byStart.set(start, { start, end, payload });
        }
    }
    const cues = Array.from(byStart.values()).sort((a, b) => a.start - b.start);
    if (!cues.length) return null;
    for (let i = 0; i < cues.length - 1; i++) {
        if (cues[i].end > cues[i + 1].start) cues[i].end = Math.max(cues[i].start + 0.001, cues[i + 1].start);
    }
    return 'WEBVTT\n\n' + cues.map((cue, index) =>
        `${index + 1}\n${toTimestamp(cue.start)} --> ${toTimestamp(cue.end)}\n${cue.payload}`
    ).join('\n\n') + '\n';
}
