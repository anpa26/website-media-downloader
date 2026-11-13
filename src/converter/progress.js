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




function updateSegmentProgressStatus(loadingBar, processed, total) {
  if (!loadingBar || !loadingBar.parentNode) return;
  let statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
  if (!statusInfo) {
    statusInfo = document.createElement('div');
    statusInfo.className = 'download-status-info';
    loadingBar.parentNode.appendChild(statusInfo);
  }
  const percent = Math.round((processed / total) * 100);
  statusInfo.textContent = browser.i18n.getMessage("segmentProgress", [processed.toString(), total.toString(), percent.toString()]);

  loadingBar.value = (processed / total) * 100;
  loadingBar.removeAttribute('indeterminate');
}
function updateProgressStatus(loadingBar, downloaded, total, statusInfo, url = null) {
    loadingBar.value = Math.round((downloaded / total) * 100);
    let targetStatusInfo = statusInfo;
    if (!targetStatusInfo && loadingBar && loadingBar.parentNode) {
        targetStatusInfo = loadingBar.parentNode.querySelector('.download-status-info');
    }
    if (targetStatusInfo) {
        const percent = Math.round((downloaded / total) * 100);
        const loadedMB = (downloaded / 1048576).toFixed(1);
        const totalMB = (total / 1048576).toFixed(1);
        const isPaused = url && window.activePauses && window.activePauses.has(url);
        const statusPrefix = isPaused ? `[${browser.i18n.getMessage("pausedStatus") || "Paused"}] ` : "Downloading: ";
        targetStatusInfo.textContent = `${statusPrefix}${percent}% (${loadedMB}MB / ${totalMB}MB)`;
    }
}
