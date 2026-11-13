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

let cacheListener = null;
let mediaCacheEnabled = false;

function detachCacheListener() {
    if (!cacheListener) return;
    try {
        browser.webRequest.onBeforeRequest.removeListener(cacheListener);
    } catch (e) {  }
    cacheListener = null;
    console.debug("Cache listener detached.");
}

function attachCacheListener() {
    if (cacheListener) return;

    if (!browser.webRequest || !browser.webRequest.filterResponseData) {
        console.warn("filterResponseData not available; not attaching cache listener.");
        return;
    }

    const requestBuffers = new Map();

    cacheListener = (details) => {
        try {

            if (details.incognito) return;
            const mType = getMediaType(details.url);
            if (isMediaTypeDisabled(mType, cachedSettings)) return;

            if (!detectionRegex.test(details.url)) return;

            let filter;
            try {
                filter = browser.webRequest.filterResponseData(details.requestId);
            } catch (e) {
                console.warn("filterResponseData failed for requestId", details.requestId, e);
                return;
            }

            const downloadId = details.url;
            requestBuffers.set(details.requestId, { chunks: [], size: 0, totalCached: 0, index: 0 });

            const flushBuffer = async (reqId) => {
                const state = requestBuffers.get(reqId);
                if (!state || state.chunks.length === 0) return;

                const blob = new Blob(state.chunks);
                const currentIndex = state.index++;
                state.chunks = [];
                state.size = 0;

                await storeChunkInCache(downloadId, currentIndex, blob);
            };

            filter.ondata = (event) => {
                try {

                    filter.write(event.data);

                    const state = requestBuffers.get(details.requestId);
                    if (state) {
                        state.chunks.push(event.data);
                        state.size += event.data.byteLength;
                        state.totalCached += event.data.byteLength;

                        let currentThreshold = 1024 * 1024; // 1MB
                        if (state.totalCached > 50 * 1024 * 1024) {
                            currentThreshold = 4 * 1024 * 1024; // 4MB
                        } else if (state.totalCached > 10 * 1024 * 1024) {
                            currentThreshold = 2 * 1024 * 1024; // 2MB
                        }

                        if (state.size >= currentThreshold) {
                            flushBuffer(details.requestId).catch(err => console.error("Failed to flush buffer:", err));
                        }
                    }
                } catch (e) {
                    console.error("Error writing chunk back to filter:", e);
                }
            };
            filter.onstop = async () => {
                try {
                    await flushBuffer(details.requestId);
                    requestBuffers.delete(details.requestId);
                    filter.disconnect();

                    await storeInCache(downloadId, null, 'application/octet-stream');
                } catch (e) {
                    console.error("Failed to cache response body for", details.url, e);
                }
            };
            filter.onerror = (err) => {
                try { filter.disconnect(); } catch (e) {}
                console.error("filter error:", err);
            };
        } catch (e) {
            console.error("Error in cache listener:", e);
        }
    };

    browser.webRequest.onBeforeRequest.addListener(
        cacheListener,
        { urls: ["<all_urls>"],  },
        ["blocking"]
    );

    console.debug("Cache listener attached.");
}

async function initCacheState() {
    try {
        const res = await browser.storage.local.get(['media-cache', 'mime-detection', 'url-detection']);
        const enabled = !!isFlagEnabled(res['media-cache']);
        mediaCacheEnabled = enabled;
        const detectionEnabled = isFlagEnabled(res['mime-detection'], true) || isFlagEnabled(res['url-detection'], true);
        if (mediaCacheEnabled && detectionEnabled) {
            attachCacheListener();
        } else {
            detachCacheListener();
        }
    } catch (e) {
        console.error("Failed to read media-cache setting:", e);

        mediaCacheEnabled = false;
        detachCacheListener();
    }
}
initCacheState();
