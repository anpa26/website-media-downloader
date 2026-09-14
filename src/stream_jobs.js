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

if (typeof browser === 'undefined') var browser = chrome;

const persistentStreamJobs = new Map();
const streamZipResolvers = new Map();
const cancelledPersistentStreamJobs = new Set();
const persistentZipJobs = new Map();
let streamOffscreenCreating = null;
const zipNotificationTimes = new Map();

async function zipNotificationsEnabled() {
    const settings = await browser.storage.local.get('fetch-notification').catch(() => ({}));
    return settings['fetch-notification'] !== '0';
}

async function showZipNotification(jobId, title, message, force = false) {
    if (!browser.notifications || !await zipNotificationsEnabled()) return;
    const now = Date.now();
    if (!force && now - (zipNotificationTimes.get(jobId) || 0) < 500) return;
    zipNotificationTimes.set(jobId, now);
    const options = {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon.png'),
        title,
        message: message || ''
    };
    try {
        const updated = browser.notifications.update
            ? await browser.notifications.update(jobId, options).catch(() => false)
            : false;
        if (!updated) await browser.notifications.create(jobId, options);
    } catch (error) {
        console.warn('ZIP notification error:', error);
    }
}

async function finishZipNotification(jobId, success, filename, error) {
    if (!browser.notifications || !await zipNotificationsEnabled()) return;
    zipNotificationTimes.delete(jobId);
    try { await browser.notifications.clear(jobId); } catch (e) {}
    if (error === 'USER_CANCELED') return;
    const completeId = `${jobId}_${success ? 'complete' : 'error'}`;
    await browser.notifications.create(completeId, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon.png'),
        title: success
            ? (browser.i18n.getMessage('downloadCompleteTitle') || 'Download completed')
            : 'Download failed',
        message: success ? (filename || 'ZIP') : (error || 'ZIP processing failed')
    }).catch(() => {});
    setTimeout(() => browser.notifications.clear(completeId).catch(() => {}), 5000);
}

async function finalizeStreamRecovery(key, state = "completed") {
    try {
        const stored = await browser.storage.local.get(key);
        const job = stored[key];
        if (!job) return;
        await browser.storage.local.set({ [key]: { ...job, recoveryState: state, status: state } });
        await browser.storage.local.remove(key);
    } catch (error) {
        console.warn("Failed to finalize stream recovery:", error);
    }
}

function broadcastStreamJob(message) {
    browser.tabs.query({}).then(tabs => {
        for (const tab of tabs) {
            if (tab.id !== undefined && /^https?:/i.test(tab.url || '')) {
                browser.tabs.sendMessage(tab.id, message).catch(() => {});
            }
        }
    }).catch(() => {});
}

async function ensureStreamOffscreenDocument() {
    if (!browser.offscreen?.createDocument) return false;
    const url = browser.runtime.getURL('offscreen.html');
    if (browser.runtime.getContexts) {
        const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
        if (contexts.length) return true;
    } else if (browser.offscreen.hasDocument && await browser.offscreen.hasDocument().catch(() => false)) {
        return true;
    }
    if (!streamOffscreenCreating) {
        streamOffscreenCreating = browser.offscreen.createDocument({
            url: 'offscreen.html', reasons: ['BLOBS', 'WORKERS'],
            justification: 'Download and process streams without opening a visible tab'
        }).finally(() => { streamOffscreenCreating = null; });
    }
    await streamOffscreenCreating;
    return true;
}

async function processStreamItemForZip(item, progressId) {
    const jobId = 'zip_stream_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const job = {
        jobId, zip: true, url: item.url, filename: item.filename,
        request: item.request || item.originalRequest || {},
        quality: item.quality || "highest", downloadMethod: "browser", progressId, recoveryState: "running"
    };
    await browser.storage.local.set({ [`streamJob_${jobId}`]: job });
    const resultPromise = new Promise((resolve, reject) => streamZipResolvers.set(jobId, {
        resolve, reject, progressId, filename: item.filename, url: item.url
    }));
    try {
        if (await ensureStreamOffscreenDocument()) {
            await browser.runtime.sendMessage({ action: 'startOffscreenStreamJob', jobId });
        } else {
            const processorTab = await browser.tabs.create({
                url: browser.runtime.getURL(`stream_processor.html?job=${encodeURIComponent(jobId)}`), active: false
            });
            const task = streamZipResolvers.get(jobId);
            if (task) task.processorTabId = processorTab.id;
        }
    } catch (error) {
        streamZipResolvers.delete(jobId);
        await browser.storage.local.remove(`streamJob_${jobId}`);
        throw error;
    }
    return resultPromise;
}

globalThis.processStreamItemForZip = processStreamItemForZip;

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startPersistentZipJob') {
        const jobId = 'zip_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const job = {
            jobId, items: message.items || [],
            filename: `downloads_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`, recoveryState: "running"
        };
        persistentZipJobs.set(jobId, job);
        broadcastStreamJob({
            action: 'zipJobUpdate', jobId, filename: job.filename,
            text: 'Preparing ZIP...', percent: 0, indeterminate: true
        });
        showZipNotification(
            jobId,
            browser.i18n.getMessage('downloadingTitle') || 'Downloading...',
            `Preparing ZIP: ${job.items.length} file(s)`,
            true
        );
        if (typeof activeDownloads !== 'undefined') {
            activeDownloads.set(jobId, {
                id: jobId, url: `zip://${jobId}`, filename: job.filename,
                loaded: 0, total: job.items.length, status: 'downloading',
                mediaType: 'file', isZip: true, isPersistentZipJob: true
            });
        }
        browser.storage.local.set({ [`zipJob_${jobId}`]: job }).then(async () => {
            if (await ensureStreamOffscreenDocument()) {
                await browser.runtime.sendMessage({ action: 'startOffscreenZipJob', jobId });
                return { offscreen: true };
            }
            return browser.tabs.create({
                url: browser.runtime.getURL(`stream_processor.html?zipJob=${encodeURIComponent(jobId)}`), active: false
            });
        }).then(processor => {
            if (processor?.id !== undefined) job.processorTabId = processor.id;
            sendResponse({ success: true, downloadId: jobId });
        }).catch(error => {
            persistentZipJobs.delete(jobId);
            if (typeof activeDownloads !== 'undefined') activeDownloads.delete(jobId);
            browser.storage.local.remove(`zipJob_${jobId}`);
            finishZipNotification(jobId, false, job.filename, error.message);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    if (message.action === 'zipProcessorProgress') {
        let job = persistentZipJobs.get(message.jobId);
        if (!job && typeof activeDownloads !== 'undefined' && activeDownloads.has(message.jobId)) {
            const item = activeDownloads.get(message.jobId);
            job = { jobId: message.jobId, filename: item.filename };
            persistentZipJobs.set(message.jobId, job);
        }
        if (job) {
            if (typeof activeDownloads !== 'undefined') {
                const item = activeDownloads.get(message.jobId);
                if (item) {
                    item.loaded = message.loaded ?? item.loaded;
                    item.total = message.total ?? item.total;
                    item.status = message.status || item.status;
                    item.statusText = message.text || item.statusText;
                    item.currentFile = message.currentFile || item.currentFile;
                    item.percent = message.percent;
                    activeDownloads.set(message.jobId, item);
                }
            }
            browser.runtime.sendMessage({
                action: 'zipProgress', id: message.jobId,
                loaded: message.loaded, total: message.total,
                status: message.status, currentFile: message.currentFile,
                text: message.text, percent: message.percent,
                indeterminate: message.indeterminate
            }).catch(() => {});
            broadcastStreamJob({
                action: 'zipJobUpdate', jobId: message.jobId, filename: job.filename,
                text: message.text || message.currentFile || 'Creating ZIP...',
                percent: message.percent, loaded: message.loaded, total: message.total,
                indeterminate: message.indeterminate
            });
            const progress = message.percent !== undefined
                ? `${Math.max(0, Math.min(100, Math.round(message.percent)))}%`
                : `${message.loaded || 0}/${message.total || job.items?.length || 0}`;
            showZipNotification(
                message.jobId,
                browser.i18n.getMessage('downloadingTitle') || 'Downloading...',
                `${progress} — ${message.text || message.currentFile || job.filename || 'ZIP'}`
            );
        }
        sendResponse({ success: true });
        return;
    }
    if (message.action === 'zipProcessorComplete') {
        const job = persistentZipJobs.get(message.jobId) || {
            jobId: message.jobId, filename: message.filename
        };
        if (job) {
            broadcastStreamJob({
                action: 'zipJobUpdate', jobId: message.jobId,
                filename: message.filename || job.filename,
                text: message.success ? 'Complete!' : (message.error === 'USER_CANCELED' ? 'Cancelled' : (message.error || 'Failed')),
                percent: message.success ? 100 : undefined,
                complete: true, success: !!message.success
            });
            finishZipNotification(
                message.jobId, !!message.success,
                message.filename || job.filename, message.error
            );
            browser.runtime.sendMessage({
                action: message.success ? 'zipComplete' : 'zipError',
                id: message.jobId, filename: message.filename || job.filename,
                error: message.error
            }).catch(() => {});
            persistentZipJobs.delete(message.jobId);
            if (typeof activeDownloads !== 'undefined') activeDownloads.delete(message.jobId);
            finalizeStreamRecovery(`zipJob_${message.jobId}`, message.success ? "completed" : "failed");
        }
        sendResponse({ success: true });
        return;
    }
    if (message.action === 'streamZipComplete') {
        const resolver = streamZipResolvers.get(message.jobId);
        if (resolver) {
            streamZipResolvers.delete(message.jobId);
            finalizeStreamRecovery(`streamJob_${message.jobId}`, message.success ? "completed" : "failed");
            if (message.success) resolver.resolve(message.files || []);
            else resolver.reject(new Error(message.error || 'Stream ZIP processing failed'));
        }
        sendResponse({ success: true });
        return;
    }
    if (message.action === 'startPersistentStreamJob') {
        const jobId = 'stream_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const job = { ...message, action: undefined, jobId, recoveryState: "running" };
        persistentStreamJobs.set(jobId, job);
        if (typeof activeDownloads !== 'undefined') {
            activeDownloads.set(jobId, {
                id: jobId, url: job.url, filename: job.filename,
                loaded: 0, total: 100, percent: 0, status: 'Preparing stream...',
                mediaType: 'stream', isStreamJob: true
            });
        }
        broadcastStreamJob({
            action: 'streamJobUpdate', jobId, url: job.url, filename: job.filename,
            text: 'Preparing stream...', percent: 0, indeterminate: true
        });
        browser.runtime.sendMessage({
            action: 'streamPopupStatus', id: job.url,
            text: 'Preparing stream...', percent: undefined, indeterminate: true
        }).catch(() => {});
        browser.storage.local.set({ [`streamJob_${jobId}`]: job }).then(async () => {
            if (await ensureStreamOffscreenDocument()) {
                await browser.runtime.sendMessage({ action: 'startOffscreenStreamJob', jobId });
                return { offscreen: true };
            }
            return browser.tabs.create({ url: browser.runtime.getURL(`stream_processor.html?job=${encodeURIComponent(jobId)}`), active: false });
        }).then(processor => {
            if (processor?.id !== undefined) {
                job.processorTabId = processor.id;
                if (typeof activeDownloads !== 'undefined') {
                    const item = activeDownloads.get(jobId);
                    if (item) {
                        item.processorTabId = processor.id;
                        activeDownloads.set(jobId, item);
                    }
                }
            }
            sendResponse({ success: true, jobId });
        })
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    if (message.action === 'streamJobProgress') {
        if (cancelledPersistentStreamJobs.has(message.jobId)) {
            sendResponse({ success: true });
            return;
        }
        const zipTask = streamZipResolvers.get(message.jobId);
        if (zipTask) {
            browser.runtime.sendMessage({
                action: 'zipProgress', id: zipTask.progressId,
                status: 'processingStream', currentFile: zipTask.filename,
                text: message.text, percent: message.percent,
                indeterminate: message.indeterminate
            }).catch(() => {});
            sendResponse({ success: true });
            return;
        }
        let job = persistentStreamJobs.get(message.jobId);
        if (!job && message.url) {
            job = { jobId: message.jobId, url: message.url, filename: message.filename };
            persistentStreamJobs.set(message.jobId, job);
        }
        if (job) {
            if (typeof activeDownloads !== 'undefined') {
                let item = activeDownloads.get(message.jobId);
                if (!item) {
                    item = {
                        id: message.jobId, url: job.url, filename: job.filename,
                        loaded: 0, total: 100, percent: 0, status: 'Preparing stream...',
                        mediaType: 'stream', isStreamJob: true
                    };
                }
                if (item) {
                    if (message.text !== undefined) item.status = message.text;
                    if (message.percent !== undefined) item.percent = message.percent;
                    item.loaded = message.percent !== undefined ? message.percent : item.loaded;
                    item.total = message.indeterminate ? 0 : 100;
                    activeDownloads.set(message.jobId, item);
                }
            }
            browser.runtime.sendMessage({
                action: 'streamPopupStatus', id: job.url, text: message.text,
                percent: message.percent, indeterminate: message.indeterminate
            }).catch(() => {});
            broadcastStreamJob({
                action: 'streamJobUpdate', jobId: message.jobId, url: job.url, filename: job.filename,
                text: message.text, percent: message.percent, indeterminate: message.indeterminate
            });
        }
        sendResponse({ success: true });
        return;
    }
    if (message.action === 'streamJobComplete') {
        if (cancelledPersistentStreamJobs.has(message.jobId)) {
            cancelledPersistentStreamJobs.delete(message.jobId);
            sendResponse({ success: true });
            return;
        }
        const job = persistentStreamJobs.get(message.jobId) || (message.url ? {
            jobId: message.jobId, url: message.url, filename: message.filename
        } : null);
        if (job) {
            broadcastStreamJob({
                action: 'streamJobUpdate', jobId: message.jobId, url: job.url, filename: job.filename,
                text: message.success ? 'Complete!' : (message.error === 'USER_CANCELED' ? 'Cancelled' : (message.error || 'Failed')),
                percent: message.success ? 100 : undefined,
                complete: true, success: message.success
            });
            browser.runtime.sendMessage({
                action: message.success ? 'downloadComplete' : 'downloadError',
                id: job.url, url: job.url, error: message.error
            }).catch(() => {});
            persistentStreamJobs.delete(message.jobId);
            if (typeof activeDownloads !== 'undefined') activeDownloads.delete(message.jobId);
            browser.storage.local.remove(`streamJob_${message.jobId}`);
        }
        sendResponse({ success: true });
        return;
    }
    if (message.action === 'cancelDownload') {
        for (const [jobId, job] of persistentZipJobs) {
            if (message.id === jobId || message.url === `zip://${jobId}`) {
                browser.runtime.sendMessage({ action: 'cancelOffscreenZipJob', jobId }).catch(() => {});
                if (job.processorTabId !== undefined) browser.tabs.remove(job.processorTabId).catch(() => {});
                persistentZipJobs.delete(jobId);
                broadcastStreamJob({
                    action: 'zipJobUpdate', jobId, filename: job.filename,
                    text: 'Cancelled', complete: true, success: false
                });
                finishZipNotification(jobId, false, job.filename, 'USER_CANCELED');
                if (typeof activeDownloads !== 'undefined') activeDownloads.delete(jobId);
                browser.storage.local.remove(`zipJob_${jobId}`).catch(() => {});
                browser.runtime.sendMessage({ action: 'zipError', id: jobId, error: 'USER_CANCELED' }).catch(() => {});
            }
        }
        for (const [jobId, task] of streamZipResolvers) {
            if (message.id === task.progressId || message.id === jobId || message.url === task.url) {
                browser.runtime.sendMessage({ action: 'cancelOffscreenStreamJob', jobId }).catch(() => {});
                if (task.processorTabId !== undefined) browser.tabs.remove(task.processorTabId).catch(() => {});
                task.reject(new Error('Cancelled'));
                streamZipResolvers.delete(jobId);
                browser.storage.local.remove(`streamJob_${jobId}`).catch(() => {});
            }
        }
        for (const [jobId, job] of persistentStreamJobs) {
            if (message.id === job.url || message.url === job.url || message.id === jobId) {
                cancelledPersistentStreamJobs.add(jobId);
                browser.runtime.sendMessage({ action: 'cancelOffscreenStreamJob', jobId }).catch(() => {});
                if (job.processorTabId !== undefined) browser.tabs.remove(job.processorTabId).catch(() => {});
                browser.tabs.query({}).then(tabs => {
                    const jobParam = `job=${encodeURIComponent(jobId)}`;
                    for (const tab of tabs) {
                        if (tab.id !== undefined && (tab.url || '').includes('stream_processor.html') && (tab.url || '').includes(jobParam)) {
                            browser.tabs.remove(tab.id).catch(() => {});
                        }
                    }
                }).catch(() => {});
                broadcastStreamJob({
                    action: 'streamJobUpdate', jobId, url: job.url, filename: job.filename,
                    text: 'Cancelled', percent: undefined, complete: true, success: false
                });
                persistentStreamJobs.delete(jobId);
                if (typeof activeDownloads !== 'undefined') activeDownloads.delete(jobId);
                browser.storage.local.remove(`streamJob_${jobId}`).catch(() => {});
                setTimeout(() => cancelledPersistentStreamJobs.delete(jobId), 60000);
            }
        }
        sendResponse({ success: true });
        return;
    }
});
