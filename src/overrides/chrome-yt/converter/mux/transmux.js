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



async function transmuxToMp4(tsBlobs, onProgress = null) {
  console.log("Starting transmuxing with mux.js. Segments count:", tsBlobs.length);
  if (globalThis.mediaCompute?.run) {
    try {
      onProgress?.(0);
      const output = await globalThis.mediaCompute.run('transmux', { inputs: tsBlobs }, [], onProgress);
      if (output) return { blob: new Blob([output], { type: 'video/mp4' }), ext: '.mp4' };
    } catch (error) {
      console.warn('Worker transmux failed; using the compatible fallback.', error);
    }
  }

  await ensureMuxJsLoaded();
  if (typeof muxjs === 'undefined') {
    console.error("muxjs is NOT defined! Integration check failed.");
    return { blob: new Blob(tsBlobs, { type: "video/mp2t" }), ext: '.ts' };
  }

  return new Promise(async (resolve) => {
    try {
      await ensureOptionalLibraryLoaded('workers/mp4_duration.js', 'mp4Duration');
      const transmuxer = new muxjs.mp4.Transmuxer();
      let durationFinalizer = null;
      const mp4Chunks = [];
      let initSegment = null;

      transmuxer.on('data', (event) => {

        if (event.initSegment) {
          if (!initSegment) {
            durationFinalizer = mp4Duration.createFinalizer(event.initSegment);
            initSegment = durationFinalizer.initSegment;
            mp4Chunks.push(initSegment);
            console.log("Init segment collected, size:", initSegment.byteLength);
          }
        }

        if (event.data) {
          durationFinalizer.addFragment(event.data);
          mp4Chunks.push(event.data);
        }
      });

      const inputChunkSize = 8 * 1024 * 1024 - ((8 * 1024 * 1024) % 188);
      const totalBytes = tsBlobs.reduce((sum, blob) => sum + Number(blob?.size || blob?.byteLength || 0), 0);
      let processedBytes = 0;
      const flushTransmuxer = () => {
        if (!transmuxer.transmuxPipeline_ || transmuxer.transmuxPipeline_.headOfPipeline) transmuxer.flush();
      };
      onProgress?.(0);
      for (const input of tsBlobs) {
        if (input instanceof Blob && input.size > inputChunkSize) {
          for (let offset = 0; offset < input.size; offset += inputChunkSize) {
            const part = input.slice(offset, Math.min(offset + inputChunkSize, input.size));
            transmuxer.push(new Uint8Array(await part.arrayBuffer()));
            flushTransmuxer();
            processedBytes += part.size;
            onProgress?.(totalBytes > 0 ? Math.min(99, processedBytes / totalBytes * 100) : 0);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } else {
          const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : new Uint8Array(input);
          transmuxer.push(bytes);
          flushTransmuxer();
          processedBytes += bytes.byteLength;
          onProgress?.(totalBytes > 0 ? Math.min(99, processedBytes / totalBytes * 100) : 0);
        }
      }
      flushTransmuxer();

      if (mp4Chunks.length === 0) {
        console.warn("Transmuxing produced no data. Returning original TS.");
        resolve({ blob: new Blob(tsBlobs, { type: "video/mp2t" }), ext: '.ts' });
      } else {
        durationFinalizer.finish();
        console.log("Transmuxing complete. Total chunks:", mp4Chunks.length);
        onProgress?.(100);
        resolve({ blob: new Blob(mp4Chunks, { type: 'video/mp4' }), ext: '.mp4' });
      }
    } catch (err) {
      console.error("Transmuxing error:", err);
      resolve({ blob: new Blob(tsBlobs, { type: "video/mp2t" }), ext: '.ts' });
    }
  });
}
