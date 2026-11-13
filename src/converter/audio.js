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



async function offlineAudioBufferToWav(buffer, onProgress, checkCancel = null) {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const channels = [];
  for (let i = 0; i < numOfChan; i++) {
    channels.push(buffer.getChannelData(i));
  }

  const workerCode = `
    self.onmessage = function(e) {
      const { channels, sampleRate } = e.data;
      const numOfChan = channels.length;
      const totalSamples = channels[0].length;
      const length = totalSamples * numOfChan * 2 + 44;
      const buffer_out = new ArrayBuffer(length);
      const view = new DataView(buffer_out);
      let pos = 0;

      function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
      function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

      setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
      setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
      setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan);
      setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
      setUint32(length - pos - 4);

      const batchSize = 100000;
      let offset = 0;
      let lastProgressReport = 0;

      while(offset < totalSamples) {
        let end = Math.min(offset + batchSize, totalSamples);
        for(; offset < end; offset++) {
          for(let i = 0; i < numOfChan; i++) {
            let sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
            view.setInt16(pos, sample, true);
            pos += 2;
          }
        }
        let currentProgress = offset / totalSamples;
        if (currentProgress - lastProgressReport >= 0.01 || offset >= totalSamples) {
          self.postMessage({ type: 'progress', progress: currentProgress });
          lastProgressReport = currentProgress;
        }
      }

      self.postMessage({ type: 'complete', buffer: buffer_out }, [buffer_out]);
    };
  `;

  return new Promise((resolve, reject) => {
    const worker = new Worker(browser.runtime.getURL('workers/wav_worker.js'));
    let cancelInterval = null;

    if (checkCancel) {
      cancelInterval = setInterval(() => {
        if (checkCancel()) {
          if (cancelInterval) clearInterval(cancelInterval);
          worker.terminate();
          reject(new Error("Cancelled"));
        }
      }, 500);
    }

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        if (onProgress) onProgress(e.data.progress);
      } else if (e.data.type === 'complete') {
        if (cancelInterval) clearInterval(cancelInterval);
        worker.terminate();
        resolve(new Blob([e.data.buffer], { type: "audio/wav" }));
      }
    };

    worker.onerror = (err) => {
      if (cancelInterval) clearInterval(cancelInterval);
      worker.terminate();
      reject(new Error(err.message || `WAV worker failed (${err.filename || 'wav_worker.js'})`));
    };

    const buffers = channels.map(c => c.buffer);
    worker.postMessage({ channels, sampleRate }, buffers);
  });
}

async function offlineExtractAudioToWav(blob, loadingBar, checkCancel = null) {
    let extractionStage = 'initialization';
    let statusInfo = null;
    if (loadingBar) {
        loadingBar.setAttribute('indeterminate', 'true');
        statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("decodingAudio") || "Decoding Audio...";
    }

    await new Promise(r => setTimeout(r, 200));

    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    try {
        extractionStage = 'audio decode';
        const audioBuffer = await new Promise((resolve, reject) => {
            let settled = false;
            const resolveOnce = (value) => {
                if (!settled) { settled = true; resolve(value); }
            };
            const rejectOnce = (error) => {
                if (!settled) { settled = true; reject(error); }
            };
            try {
                const result = audioCtx.decodeAudioData(arrayBuffer.slice(0), resolveOnce, rejectOnce);
                if (result && typeof result.then === 'function') result.then(resolveOnce, rejectOnce);
            } catch (error) {
                rejectOnce(error);
            }
        });
        if (loadingBar) {
            loadingBar.removeAttribute('indeterminate');
            loadingBar.max = 100;
        }

        extractionStage = 'WAV encoding';
        const wavBlob = await offlineAudioBufferToWav(audioBuffer, (progress) => {
            if (checkCancel && checkCancel()) throw new Error("Cancelled");
            if (loadingBar) {
                const percent = Math.round(progress * 100);
                loadingBar.value = percent;
                if (statusInfo) statusInfo.textContent = (browser.i18n.getMessage("encodingProgress", [percent.toString()]) || `Encoding: ${percent}%`);
            }
        }, checkCancel);
        return wavBlob;
    } catch (e) {
        const errorMessage = e?.message || e?.error?.message || e?.name ||
            (typeof e === 'string' ? e : '') || 'Unknown browser media error';
        if (errorMessage === "Cancelled") throw new Error("Cancelled");
        if (errorMessage.toLowerCase().includes("unknown content type")) {
            throw new Error(browser.i18n.getMessage("audioExtractionFormatNotSupported") || "Your browser does not support audio extraction from this media format (typically .ts streams). Please download the full video and extract the audio manually.");
        }
        throw new Error(`Failed to extract audio during ${extractionStage}: ${errorMessage}`);
    } finally {
        try { audioCtx.close(); } catch(e) {}
    }
}

async function convertM4aToMp3Direct(blob, filename, loadingBar = null, checkCancel = null) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio API is not available");

    const statusInfo = loadingBar?.parentNode?.querySelector('.download-status-info');
    const audioContext = new AudioContextClass();
    try {
        if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("decodingAudio") || "Decoding audio...";
        const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
        if (checkCancel && checkCancel()) throw new Error("Cancelled");
        const wavBlob = await offlineAudioBufferToWav(audioBuffer, null, checkCancel);
        const wavFilename = filename.replace(/\.(wav|m4a|mp4|webm|ogg|opus|aac|mp3)$/i, '') + '.wav';
        return convertAudioToMp3IfEnabled(wavBlob, wavFilename, loadingBar, checkCancel, true);
    } finally {
        try { await audioContext.close(); } catch (e) {}
    }
}

async function convertAudioToMp3IfEnabled(blob, filename, loadingBar = null, checkCancel = null, force = false) {
    const settings = await browser.storage.local.get('audio-to-mp3');
    if (!force && settings['audio-to-mp3'] !== '1') return { blob, filename };

    const isWav = blob.type.includes('wav') || /\.wav$/i.test(filename);

    if (!isWav) return { blob, filename };

    let statusInfo = null;
    if (loadingBar) {
        statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
        if (statusInfo) statusInfo.textContent = "Converting to MP3...";
        loadingBar.setAttribute('indeterminate', 'true');
    }

    return new Promise((resolve, reject) => {
        const worker = new Worker('workers/mp3_worker.js');
        let cancelInterval = null;

        if (checkCancel) {
            cancelInterval = setInterval(() => {
                if (checkCancel()) {
                    if (cancelInterval) clearInterval(cancelInterval);
                    worker.terminate();
                    reject(new Error("Cancelled"));
                }
            }, 500);
        }

        worker.onmessage = (e) => {
            if (e.data.type === 'progress') {
                if (loadingBar) {
                    loadingBar.removeAttribute('indeterminate');
                    const percent = Math.round(e.data.progress * 100);
                    loadingBar.value = percent;
                    if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("convertingToMp3Progress", [percent.toString()]) || `Converting to MP3: ${percent}%`;
                }
            } else if (e.data.success) {
                resolve({ blob: e.data.blob, filename: e.data.filename });
            } else {
                console.warn("MP3 Conversion failed, using original:", e.data.error);
                resolve({ blob, filename });
            }
            if (e.data.success !== undefined) {
                if (cancelInterval) clearInterval(cancelInterval);
                worker.terminate();
            }
        };
        worker.onerror = (err) => {
            console.warn("MP3 Worker error, using original:", err);
            resolve({ blob, filename });
            if (cancelInterval) clearInterval(cancelInterval);
            worker.terminate();
        };

        blob.arrayBuffer().then(async buffer => {
            if (checkCancel && checkCancel()) {
                if (cancelInterval) clearInterval(cancelInterval);
                worker.terminate();
                return reject(new Error("Cancelled"));
            }
            const bitrateRes = await browser.storage.local.get('mp3-bitrate');
            const bitrate = bitrateRes['mp3-bitrate'] || '320';
            worker.postMessage({ id: Date.now(), data: buffer, filename, bitrate });
        }).catch(err => {
            console.error("Failed to read blob for MP3 conversion:", err);
            resolve({ blob, filename });
            if (cancelInterval) clearInterval(cancelInterval);
            worker.terminate();
        });
    });
}
