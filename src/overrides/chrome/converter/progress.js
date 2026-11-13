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



function updateProgressStatus(loadingBar, loaded, total) {
  if (!loadingBar || !loadingBar.parentNode) return;
  let statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
  if (!statusInfo) {
    statusInfo = document.createElement('div');
    statusInfo.className = 'download-status-info';
    loadingBar.parentNode.appendChild(statusInfo);
  }

  const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
  if (total > 0) {
    const totalMB = (total / (1024 * 1024)).toFixed(2);
    const percent = Math.round((loaded / total) * 100);
    const remainingMB = ((total - loaded) / (1024 * 1024)).toFixed(2);
    statusInfo.textContent = browser.i18n.getMessage("streamProgressWithSize", [loadedMB, totalMB, percent.toString(), remainingMB]) || `${loadedMB} MB / ${totalMB} MB (${percent}%) • ${remainingMB} MB remaining`;

    loadingBar.value = (loaded / total) * 100;
    loadingBar.removeAttribute('indeterminate');
  } else {
    statusInfo.textContent = browser.i18n.getMessage("streamProgressNoSize", [loadedMB]) || `${loadedMB} MB downloaded`;
    if (!loadingBar.value) loadingBar.setAttribute('indeterminate', '');
  }
}

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
