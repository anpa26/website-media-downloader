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



// Persist popup-owned operations before fetching or converting. On restart they
// replay with the same selected tracks and filename, without another rename prompt.
let replayingPopupJob = null;
let keepPopupRecovery = false;
async function rememberPopupDownload(kind, url, mediaDiv, request, filename, extra = {}) {
  const jobId = replayingPopupJob || `popup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const job = { jobId, kind, url, filename, request, ...extra,
    mediaType: mediaDiv?.dataset.type || 'file', dataset: { ...mediaDiv?.dataset },
    ytFormats: mediaDiv?.ytFormats, ytSubtitles: mediaDiv?.ytSubtitles };
  const response = await browser.runtime.sendMessage({ action: 'registerPopupRecovery', job });
  if (!response?.success) throw new Error(response?.error || 'Unable to save download recovery state');
  return jobId;
}
async function forgetPopupDownload(jobId) {
  if (jobId && jobId === replayingPopupJob && keepPopupRecovery) {
    await browser.runtime.sendMessage({ action: 'parkProcessingJob', key: `popupJob_${jobId}` });
    return;
  }
  if (jobId) await browser.runtime.sendMessage({ action: 'releasePopupRecovery', jobId });
}

async function restorePopupDownload() {
  const jobId = new URLSearchParams(location.search).get('recoveryJob');
  if (!jobId) return;
  const key = `popupJob_${jobId}`;
  const claim = await browser.runtime.sendMessage({ action: 'claimProcessingJob', key });
  if (!claim?.allowed) return;
  const job = (await browser.storage.local.get(key))[key];
  if (!job) return;
  replayingPopupJob = jobId;
  if (job.kind === 'zip') {
    await downloadAllAsZip(job.items);
    return;
  }
  await browser.storage.session.set({ [job.url]: [job.request] });
  const type = job.mediaType || 'file';
  const item = createMediaItem({ bestRequest: { ...job.request, originalUrl: job.url }, type,
    isVideo: type === 'video', isAudio: type === 'audio', isStream: type === 'stream',
    isImage: type === 'image', isSubtitle: type === 'subtitle', isFile: type === 'file',
    ytFormats: job.ytFormats, ytSubtitles: job.ytSubtitles });
  Object.assign(item.dataset, job.dataset || {});
  item.dataset.url = job.url;
  item.dataset.recoveryJob = jobId;
  item.ytFormats = job.ytFormats;
  item.ytSubtitles = job.ytSubtitles;
  document.getElementById('media-list').prepend(item);
  renderedMediaUrls.add(job.url);
  renderedMediaUrls.add(getMediaRenderKey(job.url, type));
  renderedCount++;
  if (job.kind === 'audio') await downloadAudioOnly(job.url, item, job.specificSize, job.filename);
  else await downloadFile(job.url, item, job.specificSize, true, job.audioUrl, job.subtitleUrl, job.filename);
}

window.addEventListener('load', async () => {
  if (!new URLSearchParams(location.search).has('recoveryJob')) return;
  try {
    await loadNavigationPageOnce('home', loadMediaList);
    await restorePopupDownload();
  } catch (error) {
    console.error('Popup download recovery failed:', error);
  }
});
