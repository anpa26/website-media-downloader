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
  const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function boxes(bytes) {
    const view = viewOf(bytes);
    const result = [];
    for (let offset = 0; offset < bytes.length;) {
      if (offset + 8 > bytes.length) throw new Error('Truncated MP4 box');
      let size = view.getUint32(offset);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > bytes.length) throw new Error('Truncated MP4 box size');
        size = view.getUint32(offset + 8) * 0x100000000 + view.getUint32(offset + 12);
        header = 16;
      } else if (size === 0) size = bytes.length - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > bytes.length) throw new Error('Invalid MP4 box size');
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      result.push({ type, data: bytes.subarray(offset + header, offset + size) });
      offset += size;
    }
    return result;
  }
  const child = (bytes, type) => boxes(bytes).find(box => box.type === type)?.data;
  function headerInfo(bytes, track = false) {
    if (!bytes || bytes[0] > 1) throw new Error('Unsupported MP4 duration header');
    const view = viewOf(bytes);
    const version = bytes[0];
    const field = version === 1 ? 20 : 12;
    return {
      view, version,
      timescale: track ? null : view.getUint32(field),
      id: track ? view.getUint32(field) : null,
      durationOffset: field + (track ? 8 : 4)
    };
  }
  function writeDuration(header, ticks) {
    ticks = Math.round(ticks);
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new Error('Invalid MP4 duration');
    if (header.version === 1) {
      header.view.setUint32(header.durationOffset, Math.floor(ticks / 0x100000000));
      header.view.setUint32(header.durationOffset + 4, ticks % 0x100000000);
    } else {
      // Zero means unspecified. Avoid overflow or reintroducing the unknown sentinel
      // for recordings longer than a version-0 duration field can represent.
      header.view.setUint32(header.durationOffset, ticks < 0xffffffff ? ticks : 0);
    }
  }
  function readHeaders(initSegment) {
    const moov = child(initSegment, 'moov');
    if (!moov) throw new Error('MP4 initialization has no movie header');
    const movie = headerInfo(child(moov, 'mvhd'));
    if (!movie.timescale) throw new Error('Invalid MP4 movie timescale');
    const tracks = new Map();
    for (const box of boxes(moov).filter(box => box.type === 'trak')) {
      const track = headerInfo(child(box.data, 'tkhd'), true);
      const mdia = child(box.data, 'mdia');
      const media = headerInfo(mdia && child(mdia, 'mdhd'));
      if (!media.timescale) throw new Error('Invalid MP4 track timescale');
      tracks.set(track.id, { track, media, end: 0, decodeEnd: 0, defaultDuration: 0 });
    }
    const mvex = child(moov, 'mvex');
    if (mvex) for (const box of boxes(mvex).filter(box => box.type === 'trex')) {
      const view = viewOf(box.data);
      const track = tracks.get(view.getUint32(4));
      if (track) track.defaultDuration = view.getUint32(12);
    }
    return { movie, tracks };
  }
  function updateHeaders(headers, seconds = null) {
    let movieSeconds = 0;
    for (const { track, media, end } of headers.tracks.values()) {
      const duration = seconds ?? end / media.timescale;
      writeDuration(media, duration * media.timescale);
      writeDuration(track, duration * headers.movie.timescale);
      movieSeconds = Math.max(movieSeconds, duration);
    }
    writeDuration(headers.movie, movieSeconds * headers.movie.timescale);
  }
  function setDuration(initSegment, seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Missing stream duration');
    const result = initSegment.slice();
    updateHeaders(readHeaders(result), seconds);
    return result;
  }
  function createFinalizer(initSegment) {
    const result = initSegment.slice();
    const headers = readHeaders(result);
    function addFragment(fragment) {
      for (const moof of boxes(fragment).filter(box => box.type === 'moof')) {
        for (const traf of boxes(moof.data).filter(box => box.type === 'traf')) {
          const tfhd = viewOf(child(traf.data, 'tfhd'));
          const flags = tfhd.getUint32(0) & 0xffffff;
          const track = headers.tracks.get(tfhd.getUint32(4));
          if (!track) throw new Error('Unknown MP4 fragment track');
          let position = 8 + ((flags & 1) ? 8 : 0) + ((flags & 2) ? 4 : 0);
          const defaultDuration = (flags & 8) ? tfhd.getUint32(position) : track.defaultDuration;
          const tfdt = child(traf.data, 'tfdt');
          let decodeTime = track.decodeEnd;
          if (tfdt) {
            const view = viewOf(tfdt);
            decodeTime = tfdt[0] === 1 ? view.getUint32(4) * 0x100000000 + view.getUint32(8) : view.getUint32(4);
          }
          for (const trun of boxes(traf.data).filter(box => box.type === 'trun')) {
            const view = viewOf(trun.data);
            const runFlags = view.getUint32(0) & 0xffffff;
            const count = view.getUint32(4);
            position = 8 + ((runFlags & 1) ? 4 : 0) + ((runFlags & 4) ? 4 : 0);
            const sampleFields = [0x100, 0x200, 0x400, 0x800].filter(flag => runFlags & flag).length;
            if (position + count * sampleFields * 4 > trun.data.length) throw new Error('Truncated MP4 samples');
            if (!sampleFields) {
              if (!defaultDuration && count) throw new Error('Missing MP4 sample duration');
              decodeTime += count * defaultDuration;
              track.end = Math.max(track.end, decodeTime);
              continue;
            }
            for (let i = 0; i < count; i++) {
              const duration = (runFlags & 0x100) ? view.getUint32(position) : defaultDuration;
              if (!duration) throw new Error('Missing MP4 sample duration');
              if (runFlags & 0x100) position += 4;
              if (runFlags & 0x200) position += 4;
              if (runFlags & 0x400) position += 4;
              let compositionOffset = 0;
              if (runFlags & 0x800) {
                compositionOffset = trun.data[0] === 1 ? view.getInt32(position) : view.getUint32(position);
                position += 4;
              }
              track.end = Math.max(track.end, decodeTime + compositionOffset + duration);
              decodeTime += duration;
            }
          }
          track.decodeEnd = decodeTime;
        }
      }
    }
    return { initSegment: result, addFragment, finish() { updateHeaders(headers); return result; } };
  }
  globalThis.mp4Duration = { createFinalizer, setDuration };
})();
