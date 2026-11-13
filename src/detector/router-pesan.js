    if (!window.mdu_detector_injected) {

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'ping') {
            sendResponse({ pong: true });
            return true;
        }
        if (message.action === 'manualScanTab') {
            window.__wmdForceManualScan = true;
            if (window.mdu_scan) window.mdu_scan(true);
            setTimeout(() => { window.__wmdForceManualScan = false; }, 1500);
            sendResponse({ success: true });
            return true;
        }
        if (message.action === 'get_active_downloads') {
            sendResponse(Object.fromEntries(_activeDownloads));
            return true;
        }
        if (message.action === 'audioJobUpdate' || message.action === 'streamJobUpdate' || message.action === 'zipJobUpdate') {
            applyAudioJobUpdate(message);
            sendResponse({ success: true });
            return;
        }
        if (message.action === 'audioFetchProgress') {
            if (message.url === _toastCurrentTaskId) {
                if (message.total > 0) {
                    const percent = (message.loaded / message.total) * 100;
                    updateToastProgress(percent);
                    updateToastStatus(`Downloading: ${Math.round(percent)}%`);
                } else {
                    updateToastStatus(`Downloaded ${(message.loaded / 1048576).toFixed(1)}MB`);
                }
            }
            return;
        }
        if (message.action === 'cancelDownload') {
            const url = message.url;
            if (url) {
                _activeCancellations.add(url);
                _activeDownloads.delete(url);
                hideToast(true);
            }
            sendResponse({ success: true });
            return true;
        }
        if (message.action === 'start_tab_download') {
            const { url, filename, isYouTube, audioOnly, directAudioSource, encodeM4aToMp3, request } = message;
            _activeCancellations.delete(url);
            if (processNotificationsEnabled()) showToast(url, filename, audioOnly);

            const mockLoadingBar = {
                parentNode: {
                    querySelector: (selector) => {
                        if (selector === '.download-status-info') {
                            return {
                                set textContent(val) { updateToastStatus(val); },
                                get textContent() { return ""; }
                            };
                        }
                        return null;
                    }
                },
                setAttribute: () => {},
                removeAttribute: () => {},
                set value(val) { updateToastProgress(val); },
                get value() { return 0; },
                set max(val) {}
            };

            const checkCancel = () => _activeCancellations.has(url);

            (async () => {
                try {
                    let finalBlob;
                    let finalFilename = filename;

                    if (isYouTube) {
                        updateToastStatus('Fetching metadata...');
                        const uint8Array = await window.fetchAsUint8ArrayChunked(url, mockLoadingBar, { set textContent(val) { updateToastStatus(val); } }, checkCancel);
                        finalBlob = new Blob([uint8Array.buffer]);
                    } else {
                        updateToastStatus('Connecting...');
                        const result = await browser.runtime.sendMessage({
                            action: 'fetchMediaForAudio',
                            url,
                            request
                        });
                        if (!result || !result.success) throw new Error(result?.error || 'Media download failed');
                        if (checkCancel()) throw new Error('Cancelled');
                        finalBlob = new Blob([result.arrayBuffer], { type: result.mime || 'application/octet-stream' });
                    }

                    if (encodeM4aToMp3) {
                        updateToastStatus('Converting M4A to MP3...');
                        const result = await convertM4aToMp3Direct(finalBlob, filename, mockLoadingBar, checkCancel);
                        finalBlob = result.blob;
                        finalFilename = result.filename;
                    } else if (audioOnly && !directAudioSource) {
                        updateToastStatus('Extracting Audio...');
                        const wavBlob = await offlineExtractAudioToWav(finalBlob, mockLoadingBar, checkCancel);
                        let finalResult = { blob: wavBlob, filename: filename };
                        if (typeof convertAudioToMp3IfEnabled !== 'undefined') {
                            finalResult = await convertAudioToMp3IfEnabled(wavBlob, filename, mockLoadingBar, checkCancel);
                        }
                        finalBlob = finalResult.blob;
                        finalFilename = finalResult.filename;
                    }

                    const arrayBuffer = await finalBlob.arrayBuffer();
                    browser.runtime.sendMessage({
                        action: 'download_arraybuffer',
                        arrayBuffer,
                        filename: finalFilename,
                        mime: finalBlob.type
                    }).then((res) => {
                        if (res && res.success) {
                            finishToast(true, 'Complete!');
                        } else {
                            finishToast(false, res ? res.error : 'Save failed');
                        }
                    }).catch(err => {
                        finishToast(false, err.message);
                    });

                } catch (e) {
                    if (e.message === 'Cancelled') {
                        finishToast(false, 'Cancelled');
                    } else {
                        console.error('Background download error:', e);
                        finishToast(false, e.message);
                    }
                }
            })();

            sendResponse({ success: true });
            return true;
        }
    });
    }
