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

importScripts('libraries/lame.min.js');

self.onmessage = async function(e) {
    const { id, data, filename } = e.data;
    
    try {
        const mp3Blob = await convertWavToMp3(data, (progress) => {
            self.postMessage({ type: 'progress', id, progress });
        });
        const newFilename = filename.replace(/\.wav$/i, '') + '.mp3';
        
        self.postMessage({ 
            success: true, 
            id, 
            blob: mp3Blob, 
            filename: newFilename 
        });
    } catch (error) {
        console.error("MP3 Worker error:", error);
        self.postMessage({ success: false, id, error: error.message });
    }
};

async function convertWavToMp3(arrayBuffer, onProgress) {
    const dataView = new DataView(arrayBuffer);

    const riff = String.fromCharCode(dataView.getUint8(0), dataView.getUint8(1), dataView.getUint8(2), dataView.getUint8(3));
    const wave = String.fromCharCode(dataView.getUint8(8), dataView.getUint8(9), dataView.getUint8(10), dataView.getUint8(11));
    
    let channels = 2;
    let sampleRate = 44100;
    let bitDepth = 16;
    let dataOffset = 44; 

    if (riff === 'RIFF' && wave === 'WAVE') {
        let offset = 12;
        while (offset < arrayBuffer.byteLength) {
            const chunkId = String.fromCharCode(dataView.getUint8(offset), dataView.getUint8(offset+1), dataView.getUint8(offset+2), dataView.getUint8(offset+3));
            const chunkSize = dataView.getUint32(offset + 4, true);
            if (chunkId === 'fmt ') {
                channels = dataView.getUint16(offset + 10, true);
                sampleRate = dataView.getUint32(offset + 12, true);
                bitDepth = dataView.getUint16(offset + 22, true);
            } else if (chunkId === 'data') {
                dataOffset = offset + 8;
                break;
            }
            offset += 8 + chunkSize;
        }
    } else {
        dataOffset = 0;
    }

    const pcmData = new Int16Array(arrayBuffer, dataOffset);
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
    const mp3Data = [];

    const sampleBlockSize = 1152;
    const totalSamples = pcmData.length;
    let processedSamples = 0;
    let lastProgressReport = 0;
    
    if (channels === 2) {
        const left = new Int16Array(sampleBlockSize);
        const right = new Int16Array(sampleBlockSize);
        
        for (let i = 0; i < pcmData.length; i += sampleBlockSize * 2) {
            let actualBlockSize = 0;
            for (let j = 0; j < sampleBlockSize * 2 && (i + j) < pcmData.length; j += 2) {
                left[j/2] = pcmData[i + j];
                right[j/2] = pcmData[i + j + 1];
                actualBlockSize++;
            }
            const mp3buf = mp3encoder.encodeBuffer(left.subarray(0, actualBlockSize), right.subarray(0, actualBlockSize));
            if (mp3buf.length > 0) {
                mp3Data.push(new Uint8Array(mp3buf));
            }
            
            processedSamples += sampleBlockSize * 2;
            let currentProgress = processedSamples / totalSamples;
            if (currentProgress - lastProgressReport > 0.05 || processedSamples >= totalSamples) {
                onProgress(currentProgress);
                lastProgressReport = currentProgress;
                await new Promise(r => setTimeout(r, 0));
            }
        }
    } else {
        for (let i = 0; i < pcmData.length; i += sampleBlockSize) {
            const mono = pcmData.subarray(i, i + sampleBlockSize);
            const mp3buf = mp3encoder.encodeBuffer(mono);
            if (mp3buf.length > 0) {
                mp3Data.push(new Uint8Array(mp3buf));
            }
            
            processedSamples += sampleBlockSize;
            let currentProgress = processedSamples / totalSamples;
            if (currentProgress - lastProgressReport > 0.05 || processedSamples >= totalSamples) {
                onProgress(currentProgress);
                lastProgressReport = currentProgress;
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }

    const flush = mp3encoder.flush();
    if (flush.length > 0) {
        mp3Data.push(new Uint8Array(flush));
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
}
