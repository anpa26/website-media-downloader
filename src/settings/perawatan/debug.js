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



// DEBUG_ONLY_START
function setupDebugLogControls() {
    const downloadButton = document.getElementById('download-debug-log');
    const clearButton = document.getElementById('clear-debug-log');
    const statusLabel = document.getElementById('debug-log-status');
    if (!downloadButton || downloadButton.dataset.ready === '1') return;
    downloadButton.dataset.ready = '1';

    const refreshDebugLogStatus = async () => {
        if (!statusLabel) return;
        try {
            if (window.WMDDebugLogger && typeof window.WMDDebugLogger.getStats === 'function') {
                const stats = await window.WMDDebugLogger.getStats();
                const sizeText = typeof getHumanReadableSize === 'function'
                    ? getHumanReadableSize(stats.bytes || 0)
                    : `${Math.round((stats.bytes || 0) / 1024)} KB`;
                const entriesLabel = browser.i18n.getMessage('debugLogEntriesStatus', [String(stats.count || 0), sizeText])
                    || `${stats.count || 0} log entries (${sizeText})`;
                statusLabel.textContent = entriesLabel;
            }
        } catch (_) {}
    };

    downloadButton.addEventListener('click', async () => {
        downloadButton.loading = true;
        downloadButton.disabled = true;
        try {
            let reportText = '';
            if (window.WMDDebugLogger && typeof window.WMDDebugLogger.generateReport === 'function') {
                const report = await window.WMDDebugLogger.generateReport();
                reportText = report.text;
            } else {
                const stored = await browser.storage.local.get('wmd_debug_logs');
                reportText = JSON.stringify({
                    generatedAt: new Date().toISOString(),
                    userAgent: navigator.userAgent,
                    logs: stored.wmd_debug_logs || []
                }, null, 2);
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const blobUrl = URL.createObjectURL(new Blob([reportText], { type: 'text/plain;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `wmd-debug-log-${timestamp}.log`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            await refreshDebugLogStatus();
            showSettingsMessage('debugLogDownloaded', 'Debug log downloaded successfully!');
        } catch (error) {
            console.error('Failed to download debug log:', error);
            showSettingsMessage('debugLogDownloadError', `Failed to download debug log: ${error.message}`, [error.message]);
        } finally {
            downloadButton.loading = false;
            downloadButton.disabled = false;
        }
    });

    if (clearButton) {
        clearButton.addEventListener('click', async () => {
            clearButton.loading = true;
            clearButton.disabled = true;
            try {
                if (window.WMDDebugLogger && typeof window.WMDDebugLogger.clear === 'function') {
                    await window.WMDDebugLogger.clear();
                } else {
                    await browser.storage.local.remove('wmd_debug_logs');
                }
                await refreshDebugLogStatus();
                showSettingsMessage('debugLogCleared', 'Debug log cleared.');
            } catch (error) {
                console.error('Failed to clear debug log:', error);
            } finally {
                clearButton.loading = false;
                clearButton.disabled = false;
            }
        });
    }

    refreshDebugLogStatus();
}
// DEBUG_ONLY_END
