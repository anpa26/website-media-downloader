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

    const detected = new Set();
    const reportedUrls = new Set();
    let lastReportUrl = window.location.href;
    function resetDeteksiNekPindahHalaman() {
        if (window.location.href === lastReportUrl) return;
        lastReportUrl = window.location.href;
        detected.clear();
        reportedUrls.clear();
        detectedImageDimensions.clear();
        detectedImageSizes.clear();
    }
    ['pushState', 'replaceState'].forEach((method) => {
        const asli = history[method].bind(history);
        history[method] = (...args) => { const hasil = asli(...args); resetDeteksiNekPindahHalaman(); return hasil; };
    });
    window.addEventListener('popstate', resetDeteksiNekPindahHalaman);
    const detectedImageDimensions = new Map();
    const detectedImageSizes = new Map();
    const watchedImageDimensions = new WeakSet();
    let reportTimeout = null;

    function getImageResourceSize(url, imageElement = null) {
        const candidates = [imageElement?.currentSrc, url].filter(Boolean);
        let bestSize = 0;
        for (const candidate of candidates) {
            try {
                const entries = performance.getEntriesByName(candidate, 'resource');
                for (const entry of entries) {
                    const encodedSize = Number(entry.encodedBodySize) || Number(entry.decodedBodySize) || 0;
                    const transferredSize = Number(entry.transferSize) || 0;
                    const size = encodedSize || transferredSize;
                    if (Number.isFinite(size) && size > bestSize) bestSize = Math.round(size);
                }
            } catch (e) {}
        }
        return bestSize;
    }

    function recordImageResourceSize(url, imageElement = null) {
        const size = getImageResourceSize(url, imageElement);
        if (size > 0 && size > (detectedImageSizes.get(url) || 0)) detectedImageSizes.set(url, size);
    }

    function report(isManualScan = false) {
        const newUrls = Array.from(detected).filter(u => !reportedUrls.has(u));
        if (newUrls.length === 0 && !isManualScan) return;
        const urlsToSend = isManualScan ? Array.from(detected) : newUrls;
        if (urlsToSend.length === 0) return;
        try {
            const kirim = chrome.runtime.sendMessage({
                action: 'reportDetectedMedia',
                urls: urlsToSend,
                imageDimensions: Object.fromEntries(detectedImageDimensions),
                imageSizes: Object.fromEntries(detectedImageSizes),
                pageTitle: getPageTitle(),
                pageUrl: window.location.href,
                isManualScan: !!isManualScan
            });
            if (kirim && typeof kirim.then === 'function') {
                kirim.then(() => urlsToSend.forEach(u => reportedUrls.add(u)), () => {});
            } else {
                urlsToSend.forEach(u => reportedUrls.add(u));
            }
        } catch (e) {}
    }
