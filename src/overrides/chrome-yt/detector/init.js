    if (!window.mdu_detector_injected) {

    safeStorageGet(contentStorageKeys).then((result) => {
        cachedContentSettings = result;
        const isOpt = result && (result['optimize-low-end'] === '1' || result['optimize-low-end'] === true);
        isGlobalOpt = isOpt;

        syncDetectionState();
        if (contentDetectionEnabled(result) && documentScanEnabled(result)) window.mdu_scan();
    }).catch(() => {});

    try {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && contentStorageKeys.some(key => Object.prototype.hasOwnProperty.call(changes, key))) {
                for (const [key, change] of Object.entries(changes)) cachedContentSettings[key] = change.newValue;
                syncDetectionState();
                if (contentDetectionEnabled() && documentScanEnabled()) window.mdu_scan();
            }
        });
    } catch(e) {}
    }
