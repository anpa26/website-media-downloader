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

    let scanTimeout = null;
    let pendingNodesToScan = new Set();

    async function processPendingNodes() {
        if (manualScanEnabled() || !contentDetectionEnabled() || !documentScanEnabled()) {
            pendingNodesToScan.clear();
            return;
        }
        if (pendingNodesToScan.size === 0) return;
        const nodes = Array.from(pendingNodesToScan);
        pendingNodesToScan.clear();

        const result = await safeStorageGet(contentStorageKeys);
        if (manualScanEnabled(result)) return;
        const detectDownloads = result['detect-download-links'] === '1' || result['detect-download-links'] === true;
        const initialSize = detected.size;
        const extraExts = detectDownloads ? downloadExtensions : [];

        for (const node of nodes) {
            if (!contentDetectionEnabled() || !documentScanEnabled()) return;
            if (!node.isConnected) continue;
            await processElement(node, result, detectDownloads, extraExts);
            try {
                const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
                const selector = isOpt ? 'img, video, audio, source, track, a, iframe, object, embed, [data-src], [data-url], [data-href], [data-original], [style*="background"]' : '*';
                const elements = node.querySelectorAll(selector);
                for (const el of elements) {
                    if (!contentDetectionEnabled() || !documentScanEnabled()) break;
                    await processElement(el, result, detectDownloads, extraExts);
                }
            } catch (e) {}
        }

        if (window.mdu_run_surgical_scrapers) {
            const surgicalUrls = window.mdu_run_surgical_scrapers();
            surgicalUrls.forEach(url => {
                const absolute = getAbsoluteUrl(url);
                if (absolute) {
                    const type = getUrlType(absolute) || 'video';
                    if (!isTypeDisabled(type, result)) detected.add(absolute);
                }
            });
        }

        if (maximalDocumentScanEnabled(result)) window.postMessage({ type: 'MDU_TRIGGER_DEEP_SCAN' }, '*');

        if (detected.size > initialSize || initialSize === 0) {
            if (reportTimeout) clearTimeout(reportTimeout);
            reportTimeout = setTimeout(report, 500);
        }
    }

    function queueNodesForScan(nodes) {
        nodes.forEach(node => pendingNodesToScan.add(node));
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(processPendingNodes, 100);
    }

    const observer = new MutationObserver((mutations) => {
        if (!contentDetectionEnabled() || !maximalDocumentScanEnabled()) return;
        const addedElements = [];
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    addedElements.push(node);
                }
            }
        }
        if (addedElements.length > 0) {
            queueNodesForScan(addedElements);
        }
    });

    let isObserving = false;
    function syncDetectionState() {
        const enabled = contentDetectionEnabled();
        const scanEnabled = documentScanEnabled();
        const maximalScan = maximalDocumentScanEnabled();
        const isOpt = cachedContentSettings['optimize-low-end'] === '1' || cachedContentSettings['optimize-low-end'] === true;
        isGlobalOpt = isOpt;
        window.postMessage({ type: 'MDU_UPDATE_SETTINGS', optimizeLowEnd: isOpt, detectionEnabled: enabled, documentScanEnabled: scanEnabled, documentScanMaximal: maximalScan }, '*');
        if ((!enabled || !maximalScan || isOpt) && isObserving) {
            observer.disconnect();
            isObserving = false;
            pendingNodesToScan.clear();
        } else if (enabled && maximalScan && !isOpt && !isObserving && document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
            isObserving = true;
        }
    }
