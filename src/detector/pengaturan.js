
    const contentStorageKeys = [
        'manual-scan', 'document-scan', 'document-scan-mode', 'url-detection', 'mime-detection', 'youtube-detection', 'detect-download-links', 'hide-segments', 'hide-page-components',
        'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file',
        'ignore-disabled-types', 'optimize-low-end', 'audio-process-notification', 'theme-color',
        'ui-scale'
    ];

    let cachedContentSettings = {};
    let isGlobalOpt = false;
    const settingEnabled = (value, defaultValue = true) => value === undefined || value === null ? defaultValue : value === '1' || value === true;
    const manualScanEnabled = (settings = cachedContentSettings) =>
        settingEnabled(settings['manual-scan'], false);
    const contentDetectionEnabled = (settings = cachedContentSettings) =>
        settingEnabled(settings['url-detection']) ||
        settingEnabled(settings['mime-detection']) ||
        settingEnabled(settings['detect-download-links']);
    const documentScanEnabled = (settings = cachedContentSettings) =>
        settingEnabled(settings['document-scan']);
    const maximalDocumentScanEnabled = (settings = cachedContentSettings) =>
        documentScanEnabled(settings) && settings['document-scan-mode'] === 'maximal';
    function processNotificationsEnabled() {
        return cachedContentSettings['audio-process-notification'] !== '0' &&
            cachedContentSettings['audio-process-notification'] !== false;
    }

    async function updateSettingsCache() {
        try {
            if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
                cachedContentSettings = await browser.storage.local.get(contentStorageKeys);
                syncDetectionState();
            }
        } catch(e) {}
    }
    updateSettingsCache();
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes['minimized-toast-tasks']) {
                    const list = Array.isArray(changes['minimized-toast-tasks'].newValue) ? changes['minimized-toast-tasks'].newValue : [];
                    _minimizedTasks = new Set(list);
                    if (_toastCurrentTaskId && _minimizedTasks.has(_toastCurrentTaskId)) hideToast(true);
                }
                updateSettingsCache().then(() => {
                    if (changes['theme-color'] || changes['ui-scale']) applyToastTheme();
                    if (changes['audio-process-notification'] && !processNotificationsEnabled()) {
                        hideToast(true);
                        _toastCurrentTaskId = null;
                    }
                });
            }
        });
    }

    window.addEventListener('message', (event) => {
        if (event.data) {
            if (!contentDetectionEnabled() && String(event.data.type || '').startsWith('MDU_') && event.data.type !== 'MDU_UPDATE_SETTINGS') return;
            if (event.data.type === 'MDU_DRM_DETECTED') {
                try {
                    browser.runtime.sendMessage({ action: 'drmDetected' });
                } catch (e) {}
            } else if (event.data.type === 'MDU_DOM_CHANGED') {
                if (maximalDocumentScanEnabled() && !isGlobalOpt) {
                    if (window.mdu_scan) window.mdu_scan();
                }
            } else if (event.data.type === 'MDU_WS_STREAM_DETECTED') {
                if (event.data.url) {
                    const absolute = getAbsoluteUrl(event.data.url);
                    if (absolute && !detected.has(absolute)) {
                        const type = getUrlType(absolute) || 'stream';
                        if (!isTypeDisabled(type, cachedContentSettings)) {
                            detected.add(absolute);
                            if (!manualScanEnabled() || window.__wmdForceManualScan) {
                                if (reportTimeout) clearTimeout(reportTimeout);
                                reportTimeout = setTimeout(() => report(!!window.__wmdForceManualScan), 500);
                            }
                        }
                    }
                }
            } else if (event.data.type === 'MDU_DEEP_URLS_DETECTED') {
                if (manualScanEnabled() && !window.__wmdForceManualScan) return;
                if (!maximalDocumentScanEnabled() && !window.__wmdForceManualScan) return;
                if (event.data.urls && Array.isArray(event.data.urls)) {
                    let addedAny = false;
                    event.data.urls.forEach(url => {
                        const absolute = getAbsoluteUrl(url);
                        if (absolute) {
                            const type = getUrlType(absolute);
                            if (!isTypeDisabled(type, cachedContentSettings)) {
                                if (!detected.has(absolute)) addedAny = true;
                                detected.add(absolute);
                            }
                        }
                    });
                    if (addedAny || window.__wmdForceManualScan) {
                        if (reportTimeout) clearTimeout(reportTimeout);
                        reportTimeout = setTimeout(() => report(!!window.__wmdForceManualScan), window.__wmdForceManualScan ? 100 : 500);
                    }
                }
            }
        }
    });
