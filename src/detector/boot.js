    if (window.mdu_detector_injected) {
        if (window.mdu_scan) window.mdu_scan();
    }

    if (typeof browser === 'undefined') {
        var browser = chrome;
    }
