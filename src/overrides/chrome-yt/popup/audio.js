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



function getFileName(url, maxLength = 30) {
  try {
    let parsedUrl = new URL(url);
    let fileName = parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1).split('?')[0];
    fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if(!fileName) fileName = parsedUrl.hostname;
    if (fileName.length > maxLength) fileName = fileName.substring(0, maxLength) + '…';
    return decodeURIComponent(fileName);
  } catch (e) { return browser.i18n.getMessage("defaultMediaName") || "Media File"; }
}

function getHumanReadableSize(size) {
  const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
  let sizeInBytes = parseInt(size);
  if (isNaN(sizeInBytes)) return browser.i18n.getMessage("unknownSize") || "Unknown Size";
  let i = 0;
  while (sizeInBytes > 1024 && i < units.length - 1) { sizeInBytes /= 1024; i++; }
  return `${sizeInBytes.toFixed(2)} ${units[i]}`;
}

async function audioBufferToWav(buffer, onProgress, checkCancel = null) {
  let numOfChan = buffer.numberOfChannels,
      length = buffer.length * numOfChan * 2 + 44,
      buffer_out = new ArrayBuffer(length),
      view = new DataView(buffer_out),
      channels = [], i, sample,
      offset = 0,
      pos = 0;

  function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
  setUint32(length - pos - 4);

  for(i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

  const totalSamples = buffer.length;
  const batchSize = 100000;

  while(offset < totalSamples) {
    if (checkCancel && checkCancel()) throw new Error("Cancelled");
    let end = Math.min(offset + batchSize, totalSamples);
    for(; offset < end; offset++) {
      for(i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
        view.setInt16(pos, sample, true);
        pos += 2;
      }
    }

    if (onProgress) onProgress(offset / totalSamples);
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return new Blob([buffer_out], {type: "audio/wav"});
}

async function extractAudioFromBlob(blob, filename, downloadMethod, loadingBar, checkCancel = null) {
  let statusInfo = null;
  if (loadingBar) {
      loadingBar.setAttribute('indeterminate', 'true');
      statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
      if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("decodingAudio");
  }

  await new Promise(r => setTimeout(r, 200));

  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      if (loadingBar) {
          loadingBar.removeAttribute('indeterminate');
          loadingBar.max = 100;
      }

      const wavBlob = await audioBufferToWav(audioBuffer, (progress) => {
          if (checkCancel && checkCancel()) throw new Error("Cancelled");
          if (loadingBar) {
              const percent = Math.round(progress * 100);
              loadingBar.value = percent;
              if (statusInfo) statusInfo.textContent = browser.i18n.getMessage("encodingProgress", [percent.toString()]) || `Encoding: ${percent}%`;
          }
      }, checkCancel);

      let finalBlob = wavBlob;
      let finalFilename = filename;

      if (typeof convertAudioToMp3IfEnabled !== 'undefined') {
          const mp3Result = await convertAudioToMp3IfEnabled(wavBlob, filename, loadingBar, checkCancel);
          if (mp3Result) {
              finalBlob = mp3Result.blob;
              finalFilename = mp3Result.filename;
          }
      }

      if (typeof finalizeDownload !== 'undefined') {
          await finalizeDownload(finalBlob, finalFilename, downloadMethod, loadingBar, false, false);
      } else {
          const finalUrl = URL.createObjectURL(finalBlob);
          if (downloadMethod === "browser") {
            await browser.downloads.download({ url: finalUrl, filename: finalFilename });
          } else {
            const a = document.createElement("a");
            a.href = finalUrl;
            a.download = finalFilename;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
          setTimeout(() => URL.revokeObjectURL(finalUrl), 10000);
      }
  } catch (e) {
      if (e.message && e.message.toLowerCase().includes("unknown content type")) {
          throw new Error(browser.i18n.getMessage("audioExtractionFormatNotSupported") || "Your browser does not support audio extraction from this media format (typically .ts streams). Please download the full video and extract the audio manually.");
      }
      throw new Error("Failed to extract audio. " + e.message);
  } finally {
      try { audioCtx.close(); } catch(e) {}
  }
}
