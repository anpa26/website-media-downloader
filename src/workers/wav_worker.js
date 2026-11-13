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

self.onmessage = function(event) {
    const { channels, sampleRate } = event.data;
    const channelCount = channels.length;
    const sampleCount = channels[0].length;
    const output = new ArrayBuffer(sampleCount * channelCount * 2 + 44);
    const view = new DataView(output);
    let position = 0;

    const writeUint16 = value => { view.setUint16(position, value, true); position += 2; };
    const writeUint32 = value => { view.setUint32(position, value, true); position += 4; };

    writeUint32(0x46464952); writeUint32(output.byteLength - 8); writeUint32(0x45564157);
    writeUint32(0x20746d66); writeUint32(16); writeUint16(1); writeUint16(channelCount);
    writeUint32(sampleRate); writeUint32(sampleRate * 2 * channelCount);
    writeUint16(channelCount * 2); writeUint16(16); writeUint32(0x61746164);
    writeUint32(output.byteLength - position - 4);

    const batchSize = 100000;
    let offset = 0;
    let lastProgress = 0;
    while (offset < sampleCount) {
        const end = Math.min(offset + batchSize, sampleCount);
        for (; offset < end; offset++) {
            for (let channel = 0; channel < channelCount; channel++) {
                let sample = Math.max(-1, Math.min(1, channels[channel][offset]));
                sample *= sample < 0 ? 0x8000 : 0x7FFF;
                view.setInt16(position, sample, true);
                position += 2;
            }
        }
        const progress = offset / sampleCount;
        if (progress - lastProgress >= 0.01 || offset >= sampleCount) {
            self.postMessage({ type: 'progress', progress });
            lastProgress = progress;
        }
    }

    self.postMessage({ type: 'complete', buffer: output }, [output]);
};
