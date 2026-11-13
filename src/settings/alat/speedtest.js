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



// LIGHT_EXCLUDE_SPEED_TEST_START
function setupSpeedTest() {
    const startBtn = document.getElementById('start-speed-test');
    if (!startBtn) return;

    const resultsDiv = document.getElementById('speed-test-results');
    const dlValue = document.getElementById('download-speed-value');
    const dlProgress = document.getElementById('download-test-progress');
    const dlBoostValue = document.getElementById('download-boost-speed-value');
    const dlBoostProgress = document.getElementById('download-boost-test-progress');
    const ulValue = document.getElementById('upload-speed-value');
    const ulProgress = document.getElementById('upload-test-progress');
    const ulBoostValue = document.getElementById('upload-boost-speed-value');
    const ulBoostProgress = document.getElementById('upload-boost-test-progress');
    const statusText = document.getElementById('speed-test-status');

    const speedometerContainer = document.getElementById('speedometer-container');
    const speedometerProgress = document.getElementById('speedometer-progress');
    const speedometerValue = document.getElementById('speedometer-value');

    function updateSpeedometer(bps, type) {
        if (!speedometerProgress || !speedometerValue) return;
        const Mbps = bps / 1000000;
        speedometerValue.textContent = Mbps.toFixed(2);

        const maxSpeed = 150;
        const progressFraction = Math.min(Math.sqrt(Mbps / maxSpeed), 1);
        const dashLength = progressFraction * 376.99;
        speedometerProgress.style.strokeDasharray = `${dashLength} 502.65`;

        if (type === 'download') {
            speedometerProgress.style.stroke = 'rgb(var(--mdui-color-primary))';
            speedometerProgress.style.filter = 'drop-shadow(0 0 6px rgba(var(--mdui-color-primary), 0.6))';
        } else {
            speedometerProgress.style.stroke = 'rgb(var(--mdui-color-secondary))';
            speedometerProgress.style.filter = 'drop-shadow(0 0 6px rgba(var(--mdui-color-secondary), 0.6))';
        }
    }

    startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        resultsDiv.style.display = 'flex';
        dlValue.textContent = '-';
        dlBoostValue.textContent = '-';
        ulValue.textContent = '-';
        ulBoostValue.textContent = '-';

        dlProgress.style.display = 'block';
        dlProgress.value = 0;
        dlBoostProgress.style.display = 'none';
        dlBoostProgress.value = 0;
        ulProgress.style.display = 'none';
        ulProgress.value = 0;
        ulBoostProgress.style.display = 'none';
        ulBoostProgress.value = 0;

        if (speedometerContainer) speedometerContainer.style.display = 'flex';
        if (speedometerProgress) speedometerProgress.style.strokeDasharray = '0 502.65';
        if (speedometerValue) speedometerValue.textContent = '0.00';

        try {
            const localSettings = await browser.storage.local.get(['connections']);
            const concurrency = normalizeSpeedTestConcurrency(localSettings['connections']);

            statusText.textContent = browser.i18n.getMessage("speedTestStatusTestingDownload") || "Testing download speed...";
            const downloadBps = await runDownloadTest((progress, currentBps) => {
                dlProgress.value = progress / 100;
                dlValue.textContent = formatSpeed(currentBps);
                updateSpeedometer(currentBps, 'download');
            });
            dlValue.textContent = formatSpeed(downloadBps);
            updateSpeedometer(downloadBps, 'download');
            dlProgress.style.display = 'none';

            dlBoostProgress.style.display = 'block';
            statusText.textContent = `Testing download speed boost (using ${concurrency} connections)...`;
            const downloadBoostBps = await runParallelDownloadTest(concurrency, (progress, currentBps) => {
                dlBoostProgress.value = progress / 100;
                dlBoostValue.textContent = formatSpeed(currentBps);
                updateSpeedometer(currentBps, 'download');
            });
            dlBoostValue.textContent = formatSpeed(downloadBoostBps);
            updateSpeedometer(downloadBoostBps, 'download');
            dlBoostProgress.style.display = 'none';

            ulProgress.style.display = 'block';
            statusText.textContent = browser.i18n.getMessage("speedTestStatusTestingUpload") || "Testing upload speed...";
            const uploadBps = await runUploadTest((progress, currentBps) => {
                ulProgress.value = progress / 100;
                ulValue.textContent = formatSpeed(currentBps);
                updateSpeedometer(currentBps, 'upload');
            });
            ulValue.textContent = formatSpeed(uploadBps);
            updateSpeedometer(uploadBps, 'upload');
            ulProgress.style.display = 'none';

            ulBoostProgress.style.display = 'block';
            statusText.textContent = `Testing upload speed boost (using ${concurrency} connections)...`;
            const uploadBoostBps = await runParallelUploadTest(concurrency, (progress, currentBps) => {
                ulBoostProgress.value = progress / 100;
                ulBoostValue.textContent = formatSpeed(currentBps);
                updateSpeedometer(currentBps, 'upload');
            });
            ulBoostValue.textContent = formatSpeed(uploadBoostBps);
            updateSpeedometer(uploadBoostBps, 'upload');
            ulBoostProgress.style.display = 'none';

            statusText.textContent = browser.i18n.getMessage("speedTestStatusCompleted") || "Test completed!";
        } catch (error) {
            console.error("Speed Test Error:", error);
            if (error.message && error.message.includes("429")) {
                statusText.textContent = "Rate limit aktif (HTTP 429). Harap tunggu 1-2 menit sebelum mencoba lagi.";
            } else {
                statusText.textContent = (browser.i18n.getMessage("speedTestStatusFailed") || "Test failed.") + " (" + error.message + ")";
            }
            dlProgress.style.display = 'none';
            dlBoostProgress.style.display = 'none';
            ulProgress.style.display = 'none';
            ulBoostProgress.style.display = 'none';
        } finally {
            startBtn.disabled = false;
        }
    });

    setupCollapsibleLogic();
}

function formatSpeed(bps) {
    if (!bps || bps <= 0) return "-";
    const Mbps = bps / 1000000;
    if (Mbps >= 1) {
        return Mbps.toFixed(2) + " Mbps";
    }
    const Kbps = bps / 1000;
    return Kbps.toFixed(2) + " Kbps";
}

function normalizeSpeedTestConcurrency(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(16, parsed)) : 4;
}

async function runTransferSpeedTest(direction, concurrency, onProgress) {
    concurrency = normalizeSpeedTestConcurrency(concurrency);
    const warmupMs = 1500;
    const durationMs = 10000;
    const controller = new AbortController();
    const uploads = new Set();
    let bytes = 0;
    let baseline = 0;
    let measurementStart = null;
    let measurementEnd = null;
    let measuredBytes = 0;
    let stopped = false;
    let failure = null;
    let requestId = 0;
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const payload = direction === 'upload' ? new Uint8Array(2 * 1024 * 1024) : null;
    if (payload) {
        for (let offset = 0; offset < payload.length; offset += 65536) {
            crypto.getRandomValues(payload.subarray(offset, offset + 65536));
        }
    }

    function stop(error = null) {
        if (stopped) return;
        stopped = true;
        failure = error;
        measurementEnd = performance.now();
        measuredBytes = bytes - baseline;
        controller.abort();
        for (const xhr of uploads) xhr.abort();
    }

    async function downloadRequest() {
        const response = await fetch(
            'https://speed.cloudflare.com/__down?bytes=50000000&test=' + nonce + '-' + requestId++,
            { signal: controller.signal, cache: 'no-store' }
        );
        if (!response.ok) throw new Error('Download test: HTTP ' + response.status);
        if (!response.body) throw new Error('Download test: missing response body');
        const reader = response.body.getReader();
        try {
            while (!stopped) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!stopped) bytes += value.byteLength;
            }
        } finally {
            try { await reader.cancel(); } catch (_) {}
            reader.releaseLock();
        }
    }

    function uploadRequest() {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            let loaded = 0;
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                uploads.delete(xhr);
                if (error) reject(error);
                else resolve();
            };
            uploads.add(xhr);
            xhr.open('POST', 'https://speed.cloudflare.com/__up?test=' + nonce + '-' + requestId++);
            xhr.upload.onprogress = event => {
                if (stopped) return;
                const next = Math.min(event.loaded, payload.byteLength);
                bytes += Math.max(0, next - loaded);
                loaded = Math.max(loaded, next);
            };
            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    finish(new Error('Upload test: HTTP ' + xhr.status));
                    return;
                }
                if (!stopped) bytes += payload.byteLength - loaded;
                finish();
            };
            xhr.onerror = () => finish(new Error('Upload test: network error'));
            xhr.ontimeout = () => finish(new Error('Upload test: timeout'));
            xhr.onabort = () => finish(stopped ? null : new Error('Upload test: aborted'));
            try { xhr.send(payload); } catch (error) { finish(error); }
        });
    }

    let endTimer;
    const warmupTimer = setTimeout(() => {
        baseline = bytes;
        measurementStart = performance.now();
        endTimer = setTimeout(() => stop(), durationMs);
    }, warmupMs);
    const progressTimer = setInterval(() => {
        if (stopped || measurementStart === null) return;
        const elapsed = performance.now() - measurementStart;
        if (elapsed > 0) onProgress(Math.min(elapsed / durationMs * 100, 100), (bytes - baseline) * 8000 / elapsed);
    }, 200);

    try {
        const jobs = Array.from({ length: concurrency }, async () => {
            try {
                while (!stopped) {
                    if (direction === 'download') await downloadRequest();
                    else await uploadRequest();
                }
            } catch (error) {
                if (!stopped) stop(error);
            }
        });
        await Promise.all(jobs);
        if (failure) throw failure;
        const elapsed = measurementEnd - measurementStart;
        if (measurementStart === null || elapsed <= 0 || measuredBytes <= 0) {
            throw new Error('No data transferred during speed measurement');
        }
        const bps = measuredBytes * 8000 / elapsed;
        onProgress(100, bps);
        return bps;
    } finally {
        stop();
        clearTimeout(warmupTimer);
        clearTimeout(endTimer);
        clearInterval(progressTimer);
    }
}

function runDownloadTest(onProgress) {
    return runTransferSpeedTest('download', 1, onProgress);
}

function runParallelDownloadTest(concurrency, onProgress) {
    return runTransferSpeedTest('download', concurrency, onProgress);
}

function runUploadTest(onProgress) {
    return runTransferSpeedTest('upload', 1, onProgress);
}

function runParallelUploadTest(concurrency, onProgress) {
    return runTransferSpeedTest('upload', concurrency, onProgress);
}
// LIGHT_EXCLUDE_SPEED_TEST_END
