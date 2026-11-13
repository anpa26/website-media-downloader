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

    Promise.all([
        browser.storage?.local ? browser.storage.local.get('minimized-toast-tasks').catch(() => ({})) : Promise.resolve({}),
        browser.runtime.sendMessage({ action: 'getActiveDownloads' }).catch(() => null)
    ]).then(([stored, items]) => {
        if (Array.isArray(stored?.['minimized-toast-tasks'])) {
            _minimizedTasks = new Set(stored['minimized-toast-tasks']);
        }
        const jobs = Object.values(items || {}).filter(item => item.isAudioJob || item.isStreamJob || item.isPersistentZipJob || String(item.id || '').startsWith('dl_'));
        if (jobs.length) {
            const job = jobs[jobs.length - 1];
            const pct = job.percent !== undefined ? job.percent : (job.total > 0 ? (job.loaded / job.total) * 100 : undefined);
            applyAudioJobUpdate({
                action: job.isPersistentZipJob ? 'zipJobUpdate' : (job.isStreamJob ? 'streamJobUpdate' : 'audioJobUpdate'),
                jobId: job.id, filename: job.filename,
                text: job.statusText || job.status || 'Downloading...', percent: pct, indeterminate: !(job.total > 0) && pct === undefined,
                loaded: job.loaded, total: job.total
            });
        }
    }).catch(() => {});

    window.mdu_detector_injected = true;
