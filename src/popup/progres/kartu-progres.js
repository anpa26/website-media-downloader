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



function syncGroupProgressCard(groupType) {
  if (!isGroupProgressEnabled || !isGroupingEnabled || activeGroup !== null) return;
  const card = document.querySelector(`.media-group-card[data-group-type="${groupType}"]`);
  if (!card) return;

  let container = card.querySelector(".group-progress-wrapper");
  const seenIds = new Set();
  const items = [];
  for (const d of activeGroupDownloads.values()) {
    if (d.groupType !== groupType) continue;
    const kid = String(d.id);
    if (seenIds.has(kid)) continue;
    seenIds.add(kid);
    items.push(d);
  }
  const zipItems = zipKanggoGrup(groupType);
  const hasZip = zipItems.length > 0;

  if (items.length === 0 && !hasZip) {
    if (container) container.remove();
    return;
  }

  const totalCount = items.length + zipItems.length;
  let totalPercent = 0;
  let validPercentCount = 0;
  let anyIndeterminate = false;

  items.forEach(it => {
    if (it.percent !== null && it.percent !== undefined && !it.indeterminate) {
      totalPercent += it.percent;
      validPercentCount++;
    } else {
      anyIndeterminate = true;
    }
  });

  zipItems.forEach(z => {
    if (!z.indeterminate) {
      totalPercent += Math.round(Math.min(100, Math.max(0, z.percent ?? 0)));
      validPercentCount++;
    } else {
      anyIndeterminate = true;
    }
  });

  const avgPercent = validPercentCount > 0 ? Math.round(totalPercent / validPercentCount) : 0;
  const isCombinedIndeterminate = validPercentCount === 0 && anyIndeterminate;

  let summaryText;
  if (items.length > 0 && hasZip) {
    summaryText = `${totalCount} active${!isCombinedIndeterminate ? " (" + avgPercent + "%)" : ""}`;
  } else if (hasZip) {
    summaryText = `${zipItems.length} zipping${!isCombinedIndeterminate ? " (" + avgPercent + "%)" : ""}`;
  } else {
    summaryText = `${items.length} downloading${!isCombinedIndeterminate ? " (" + avgPercent + "%)" : ""}`;
  }

  const buildItemElement = (item) => {
    const isIndeterminate = item.indeterminate || item.percent === null || item.percent === undefined;
    const pct = isIndeterminate ? 0 : Math.round(Math.min(100, Math.max(0, item.percent)));

    const itemEl = document.createElement("div");
    itemEl.className = "group-progress-mini-item";
    itemEl.dataset.id = String(item.id);
    itemEl.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 3px 2px;
      box-sizing: border-box;
      flex-shrink: 0;
    `;

    itemEl.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px;">
          <span class="group-mini-name" style="font-size: 0.73rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgb(var(--mdui-color-on-surface));">
            ${escapeHtmlPopup(item.filename || "Media File")}
          </span>
          <span class="group-mini-percent" style="font-size: 0.68rem; font-weight: 700; color: var(--primary); flex-shrink: 0;">
            ${!isIndeterminate ? pct + "%" : "..."}
          </span>
        </div>
        <mdui-linear-progress class="group-mini-bar" max="100" value="${pct}" ${isIndeterminate ? "indeterminate" : ""} style="height: 3px; border-radius: 99px;"></mdui-linear-progress>
      </div>
      <div style="display: flex; align-items: center; gap: 2px; flex-shrink: 0;">
        <mdui-button-icon class="group-pause-btn" data-id="${item.id}" style="width: 24px; height: 24px; min-width: 24px; color: var(--primary);" title="Pause / Resume">
          <mdui-icon style="font-size: 15px;">
            ${item.isPaused ? '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'}
          </mdui-icon>
        </mdui-button-icon>
        <mdui-button-icon class="group-cancel-btn" data-id="${item.id}" style="width: 24px; height: 24px; min-width: 24px; color: rgb(var(--mdui-color-error));" title="Cancel">
          <mdui-icon style="font-size: 15px;"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></mdui-icon>
        </mdui-button-icon>
      </div>
    `;

    itemEl.querySelector(".group-pause-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const downloadData = activeGroupDownloads.get(String(item.id));
      const isCurrentlyPaused = !!downloadData?.isPaused;
      const targetId = downloadData?.el?.dataset?.downloadId || item.id;
      const targetUrl = downloadData?.el?.dataset?.url || downloadData?.url;
      const action = isCurrentlyPaused ? 'resumeActiveDownload' : 'pauseDownload';
      browser.runtime.sendMessage({ action, id: targetId }).catch(() => {});
      if (targetUrl && targetUrl !== targetId) {
        browser.runtime.sendMessage({ action, id: targetUrl }).catch(() => {});
      }
      if (window.activePauses) {
        if (!isCurrentlyPaused) {
          window.activePauses.add(targetId);
          if (targetUrl) window.activePauses.add(targetUrl);
        } else {
          window.activePauses.delete(targetId);
          if (targetUrl) window.activePauses.delete(targetUrl);
        }
      }
      const dlBtn = downloadData?.el?.querySelector("#download-button");
      if (dlBtn) updatePausePlayUI(dlBtn, !isCurrentlyPaused);
      if (downloadData) {
        downloadData.isPaused = !isCurrentlyPaused;
        syncGroupProgressCard(downloadData.groupType);
      }
    });

    itemEl.querySelector(".group-cancel-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const downloadData = activeGroupDownloads.get(String(item.id));
      const cancelBtn = downloadData?.el?.querySelector("#cancel-button");
      if (cancelBtn) {
        cancelBtn.click();
      } else {
        browser.runtime.sendMessage({ action: 'cancelDownload', id: item.id }).catch(() => {});
        finishDownloadUI(String(item.id), false);
      }
    });

    return itemEl;
  };

  const buildZipItemElement = (z) => {
    const pct = z.indeterminate ? 0 : Math.round(Math.min(100, Math.max(0, z.percent ?? 0)));
    const detailText = z.text.replace(/^📦\s*/, '');

    const el = document.createElement("div");
    el.className = "group-progress-mini-item";
    el.dataset.id = z.jobId || "__zip__";
    el.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 2px;box-sizing:border-box;flex-shrink:0;";

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
          <span class="group-mini-name" style="font-size:0.73rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgb(var(--mdui-color-on-surface));">📦 ${escapeHtmlPopup(detailText)}</span>
          <span class="group-mini-percent" style="font-size:0.68rem;font-weight:700;color:var(--primary);flex-shrink:0;">${z.indeterminate ? '...' : pct + '%'}</span>
        </div>
        <mdui-linear-progress class="group-mini-bar" max="100" value="${pct}" ${z.indeterminate ? 'indeterminate' : ''} style="height:3px;border-radius:99px;"></mdui-linear-progress>
      </div>
      <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
        ${z.pauseCb ? `<mdui-button-icon class="group-zip-pause-btn" style="width:24px;height:24px;min-width:24px;color:var(--primary);" title="Pause / Resume">
          <mdui-icon style="font-size:15px;">${z.isPaused ? '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'}</mdui-icon>
        </mdui-button-icon>` : ''}
        ${z.cancelCb ? `<mdui-button-icon class="group-zip-cancel-btn" style="width:24px;height:24px;min-width:24px;color:rgb(var(--mdui-color-error));" title="Cancel ZIP">
          <mdui-icon style="font-size:15px;"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></mdui-icon>
        </mdui-button-icon>` : ''}
      </div>
    `;

    el.querySelector(".group-zip-pause-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const state = zipProgressPerJob.get(String(el.dataset.id));
      if (!state) return;
      state.pauseCb?.();
    });
    el.querySelector(".group-zip-cancel-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const state = zipProgressPerJob.get(String(el.dataset.id));
      if (!state) return;
      state.cancelCb?.();
    });

    return el;
  };

  const updateZipItemElement = (el, z) => {
    const pct = z.indeterminate ? 0 : Math.round(Math.min(100, Math.max(0, z.percent ?? 0)));
    const detailText = `📦 ${z.text.replace(/^📦\s*/, '')}`;

    const nameEl = el.querySelector(".group-mini-name");
    if (nameEl && nameEl.textContent !== detailText) nameEl.textContent = detailText;

    const pctEl = el.querySelector(".group-mini-percent");
    const pctStr = z.indeterminate ? '...' : pct + '%';
    if (pctEl && pctEl.textContent !== pctStr) pctEl.textContent = pctStr;

    const barEl = el.querySelector(".group-mini-bar");
    if (barEl) {
      if (barEl.value !== pct) barEl.value = pct;
      if (z.indeterminate && !barEl.hasAttribute("indeterminate")) barEl.setAttribute("indeterminate", "");
      else if (!z.indeterminate && barEl.hasAttribute("indeterminate")) barEl.removeAttribute("indeterminate");
    }

    const pauseIcon = el.querySelector(".group-zip-pause-btn mdui-icon");
    if (pauseIcon) {
      const targetIcon = z.isPaused
        ? '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
      if (pauseIcon.innerHTML !== targetIcon) pauseIcon.innerHTML = targetIcon;
    }
  };

  const updateExistingItemElement = (el, item) => {
    const isIndeterminate = item.indeterminate || item.percent === null || item.percent === undefined;
    const pct = isIndeterminate ? 0 : Math.round(Math.min(100, Math.max(0, item.percent)));

    const nameEl = el.querySelector(".group-mini-name");
    if (nameEl && item.filename && nameEl.textContent !== item.filename) {
      nameEl.textContent = item.filename;
    }

    const pctEl = el.querySelector(".group-mini-percent");
    const newPctText = !isIndeterminate ? pct + "%" : "...";
    if (pctEl && pctEl.textContent !== newPctText) {
      pctEl.textContent = newPctText;
    }

    const barEl = el.querySelector(".group-mini-bar");
    if (barEl) {
      if (barEl.value !== pct) barEl.value = pct;
      if (isIndeterminate && !barEl.hasAttribute("indeterminate")) {
        barEl.setAttribute("indeterminate", "");
      } else if (!isIndeterminate && barEl.hasAttribute("indeterminate")) {
        barEl.removeAttribute("indeterminate");
      }
    }

    const pauseIcon = el.querySelector(".group-pause-btn mdui-icon");
    if (pauseIcon) {
      const targetIconHTML = item.isPaused
        ? '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
      if (pauseIcon.innerHTML !== targetIconHTML) {
        pauseIcon.innerHTML = targetIconHTML;
      }
    }
  };

  if (!container) {
    container = document.createElement("div");
    container.className = "group-progress-wrapper";
    container.dataset.expanded = "0";
    container.style.cssText = "width: 100%; margin-top: 10px; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box;";
    container.addEventListener("click", (e) => e.stopPropagation());

    container.innerHTML = `
      <div class="group-progress-summary-bar" style="
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        cursor: pointer;
        user-select: none;
      ">
        <div style="flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: var(--on-surface-variant);">
            <span class="group-summary-title" style="font-weight: 600; color: var(--primary);"></span>
            <span class="group-summary-percent"></span>
          </div>
          <mdui-linear-progress class="group-summary-bar" max="100" value="0" style="height: 4px; border-radius: 99px;"></mdui-linear-progress>
        </div>
        <mdui-button-icon class="group-expand-toggle-btn" style="width: 24px; height: 24px; min-width: 24px; color: var(--on-surface-variant); transition: transform 0.2s;" title="Toggle Details">
          <mdui-icon style="font-size: 18px;"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg></mdui-icon>
        </mdui-button-icon>
      </div>
      <div class="group-progress-details" style="
        display: none;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
        padding-top: 6px;
        border-top: 1px dashed rgba(var(--mdui-color-outline-variant), 0.3);
        max-height: 140px;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: none;
        -ms-overflow-style: none;
        touch-action: pan-y;
      ">
      </div>
    `;

    const summaryBar = container.querySelector(".group-progress-summary-bar");
    const toggleBtn = container.querySelector(".group-expand-toggle-btn");
    const detailsList = container.querySelector(".group-progress-details");

    const toggleExpand = (e) => {
      e.stopPropagation();
      const isNowExpanded = container.dataset.expanded === "1";
      container.dataset.expanded = isNowExpanded ? "0" : "1";
      detailsList.style.display = isNowExpanded ? "none" : "flex";
      toggleBtn.style.transform = isNowExpanded ? "rotate(0deg)" : "rotate(180deg)";
    };

    summaryBar.addEventListener("click", toggleExpand);
    card.appendChild(container);
  }

  const titleSpan = container.querySelector(".group-summary-title");
  if (titleSpan && titleSpan.textContent !== summaryText) {
    titleSpan.textContent = summaryText;
  }

  const pctSpan = container.querySelector(".group-summary-percent");
  const pctStr = !isCombinedIndeterminate ? avgPercent + "%" : "";
  if (pctSpan && pctSpan.textContent !== pctStr) {
    pctSpan.textContent = pctStr;
  }

  const sumBar = container.querySelector(".group-summary-bar");
  if (sumBar) {
    if (sumBar.value !== avgPercent) sumBar.value = avgPercent;
    if (isCombinedIndeterminate && !sumBar.hasAttribute("indeterminate")) {
      sumBar.setAttribute("indeterminate", "");
    } else if (!isCombinedIndeterminate && sumBar.hasAttribute("indeterminate")) {
      sumBar.removeAttribute("indeterminate");
    }
  }

  const detailsList = container.querySelector(".group-progress-details");
  if (detailsList) {
    const existingMap = new Map();
    detailsList.querySelectorAll(".group-progress-mini-item").forEach(el => {
      existingMap.set(el.dataset.id, el);
    });

    const currentIds = new Set(items.map(it => String(it.id)));
    zipItems.forEach(z => currentIds.add(String(z.jobId || '__zip__')));

    existingMap.forEach((el, id) => {
      if (!currentIds.has(id)) el.remove();
    });

    items.forEach(it => {
      const idStr = String(it.id);
      const existingEl = existingMap.get(idStr);
      if (existingEl) {
        updateExistingItemElement(existingEl, it);
      } else {
        detailsList.appendChild(buildItemElement(it));
      }
    });

    zipItems.forEach(z => {
      const zipId = String(z.jobId || '__zip__');
      const existingZip = existingMap.get(zipId);
      if (existingZip) {
        updateZipItemElement(existingZip, z);
      } else {
        detailsList.appendChild(buildZipItemElement(z));
      }
    });
  }
}
