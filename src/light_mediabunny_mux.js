async function downloadAndMuxYoutube(videoUrl, audioUrl, filename, downloadMethod, loadingBar, returnBlob = false) {
    const statusInfo = loadingBar?.parentNode?.querySelector('.download-status-info') || null;
    const audioSourceUrl = Array.isArray(audioUrl) ? audioUrl[0]?.url : audioUrl;
    if (!audioSourceUrl) throw new Error('No audio stream was provided.');

    if (window.activeCancellations) {
        window.activeCancellations.delete(videoUrl);
        window.activeCancellations.delete(audioSourceUrl);
    }

    const isCancelled = () => window.activeCancellations?.has(videoUrl)
        || window.activeCancellations?.has(audioSourceUrl);
    const isPaused = () => window.activePauses?.has(videoUrl)
        || window.activePauses?.has(audioSourceUrl);

    let videoInput = null;
    let audioInput = null;
    let output = null;
    try {
        if (Array.isArray(audioUrl) && audioUrl.length > 1) {
            throw new Error('Multiple audio tracks are not supported in the Light edition.');
        }

        if (loadingBar) loadingBar.setAttribute('indeterminate', 'true');
        if (statusInfo) statusInfo.textContent = 'Downloading video and audio...';

        const [videoData, audioData] = await Promise.all([
            window.fetchAsUint8ArrayChunked(videoUrl, loadingBar, statusInfo, isCancelled, isPaused),
            window.fetchAsUint8ArrayChunked(audioSourceUrl, loadingBar, statusInfo, isCancelled, isPaused)
        ]);
        if (isCancelled()) throw new Error('Cancelled');

        if (statusInfo) statusInfo.textContent = 'Muxing... 0%';
        if (loadingBar) {
            loadingBar.removeAttribute('indeterminate');
            loadingBar.max = 100;
            loadingBar.value = 0;
        }

        const {
            ALL_FORMATS, BlobSource, BufferTarget, Conversion,
            Input, Mp4OutputFormat, Output
        } = Mediabunny;
        videoInput = new Input({
            source: new BlobSource(new Blob([videoData])),
            formats: ALL_FORMATS
        });
        audioInput = new Input({
            source: new BlobSource(new Blob([audioData])),
            formats: ALL_FORMATS
        });
        const target = new BufferTarget();
        output = new Output({ format: new Mp4OutputFormat(), target });
        const copyOptions = { mode: 'forced' };
        const [videoConversion, audioConversion] = await Promise.all([
            Conversion.init({
                input: videoInput,
                output,
                video: {},
                audio: { discard: true },
                copy: copyOptions,
                composable: true,
                showWarnings: false
            }),
            Conversion.init({
                input: audioInput,
                output,
                video: { discard: true },
                audio: {},
                copy: copyOptions,
                composable: true,
                showWarnings: false
            })
        ]);

        if (videoConversion.utilizedTracks.length === 0 || audioConversion.utilizedTracks.length === 0) {
            const reasons = [...videoConversion.discardedTracks, ...audioConversion.discardedTracks]
                .map(item => item.reason).filter(Boolean).join(', ');
            throw new Error(`The selected streams cannot be copied into MP4${reasons ? ` (${reasons})` : ''}.`);
        }

        const updateProgress = () => {
            const values = [videoConversion, audioConversion]
                .map(conversion => conversion.__lightProgress || 0);
            const progress = Math.round(Math.min(...values) * 100);
            if (loadingBar) loadingBar.value = progress;
            if (statusInfo) statusInfo.textContent = `Muxing... ${progress}%`;
        };
        videoConversion.onProgress = progress => {
            videoConversion.__lightProgress = progress;
            updateProgress();
        };
        audioConversion.onProgress = progress => {
            audioConversion.__lightProgress = progress;
            updateProgress();
        };

        await output.start();
        await Promise.all([videoConversion.execute(), audioConversion.execute()]);
        await output.finalize();
        if (!target.buffer) throw new Error('Mediabunny did not produce an MP4 file.');

        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        if (returnBlob) return blob;
        const finalFilename = filename.replace(/\.[^/.]+$/, '') + '.mp4';
        await finalizeDownload(blob, finalFilename, downloadMethod, loadingBar, false, false);
    } catch (error) {
        if (error.message === 'Cancelled') {
            if (statusInfo) statusInfo.textContent = browser.i18n.getMessage('downloadCancelled') || 'Download cancelled';
        } else {
            console.error('Mediabunny muxing failed:', error);
            alert('Muxing Error: ' + (error.stack || error.message || error));
        }
        try { await output?.cancel(); } catch (_) {}
        throw error;
    } finally {
        videoInput?.dispose();
        audioInput?.dispose();
    }
}

