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



if (!browser.storage.session) {
  browser.storage.session = {
      get: (keys, cb) => browser.storage.local.get(keys, cb),
      set: (obj, cb) => browser.storage.local.set(obj, cb),
      remove: (keys, cb) => browser.storage.local.remove(keys, cb),
      clear: (cb) => browser.storage.local.clear(cb)
  };
}

let downloadingCount = 0;
let ratingCount = 0;
let allMediaRequests = [];
let allFilteredRequests = [];
let kunciMediaSudahDiunduh = new Set();
let renderedCount = 0;
let indeksChunkSabanjure = 0;
const CHUNK_SIZE = 20;
let intersectionObserver = null;
let isRenderingChunk = false;
const renderedMediaUrls = new Set();
const mediaPreviewLoadObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.loadMediaPreview?.();
    mediaPreviewLoadObserver.unobserve(entry.target);
  });
}, { rootMargin: '400px 0px' });
const imageThumbObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const img = entry.target;
    if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
    imageThumbObserver.unobserve(img);
  });
}, { rootMargin: '400px 0px' });
const uiCache = new Map();
let isGroupingEnabled = true;
let isGroupProgressEnabled = true;
let activeGroup = null;
let activeDownloadingElements = [];
const activeGroupDownloads = new Map();

const selectedUrls = new Set();

window.activeCancellations = new Set();
window.activeCancellations.restoreCallbacks = new Map();
window.activeCancellations.setRestoreCallback = (url, cb) => {
  window.activeCancellations.restoreCallbacks.set(url, cb);
};
window.activePauses = new Set();
window.activeAbortControllers = new Map();
