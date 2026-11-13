
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

        const result = await browser.storage.local.get(contentStorageKeys);
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

        if (maximalDocumentScanEnabled(result)) try {
            const script = document.createElement('script');
            script.textContent = 'if(window.mdu_deep_scan) window.mdu_deep_scan();';
            (document.head || document.documentElement).appendChild(script);
            script.remove();
        } catch (e) {}

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
        document.documentElement?.setAttribute('data-wmd-detection-enabled', enabled ? '1' : '0');
        document.documentElement?.setAttribute('data-wmd-document-scan-enabled', scanEnabled ? '1' : '0');
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
