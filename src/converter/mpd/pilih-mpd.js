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



async function selectMPDVideoRepresentation(reps, selectedQuality = null) {

  if (reps.length === 1) {
    return reps[0];
  }

  const urlParams = new URLSearchParams(window.location.search);
  const targetQuality = selectedQuality || urlParams.get('quality');
  if (targetQuality) {
      let match = null;
      if (targetQuality === 'highest' || targetQuality === 'best') {
          match = reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
      } else if (targetQuality === 'lowest') {
          match = reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
      } else {
          const parts = targetQuality.split('@');
          if (parts.length >= 3) {
              const res = parts[0];
              const bw = parseInt(parts[1], 10);
              const repId = parts.slice(2).join('@');
              match = reps.find(r => `${r.width}x${r.height}` === res && r.bandwidth === bw && r.id === repId);
          } else if (parts.length === 2) {
              const res = parts[0];
              const bw = parseInt(parts[1], 10);
              match = reps.find(r => `${r.width}x${r.height}` === res && r.bandwidth === bw);
          }
          if (!match) {
              match = reps.find(r => r.id === targetQuality || `${r.width}x${r.height}` === targetQuality || r.bandwidth.toString() === targetQuality);
          }
      }
      if (match) {
          return match;
      }
  }

  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"]));

  if (preference === "highest") {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  } else if (preference === "lowest") {
    return reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
  }

  return new Promise((resolve) => {

    const dialog = document.createElement("mdui-dialog");
    dialog.headline = browser.i18n.getMessage("videoQualityDialogTitle");

    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.setAttribute("for", "mpd-video-select");
    label.textContent = browser.i18n.getMessage("videoQualitySelectLabel");
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");
    select.setAttribute("id", "mpd-video-select");

    select.value = "0";

    const sorted = reps.slice().sort((a, b) => a.bandwidth - b.bandwidth);

    sorted.forEach((r, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);
      const kbps = Math.round(r.bandwidth / 1000).toString();
      option.textContent = browser.i18n.getMessage("qualityResolutionBandwidth", [r.width.toString(), r.height.toString(), kbps]) || `${r.width}×${r.height} (${kbps} kbps)`;
      select.appendChild(option);
    });

    content.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";
    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const idx = parseInt(select.value, 10) || 0;
      document.body.removeChild(dialog);

      resolve(sorted[idx]);
    });
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);

    document.body.appendChild(dialog);

    requestAnimationFrame(() => { dialog.open = true; });
  });
}

async function selectMPDAudioRepresentation(reps, selectedQuality = null) {

  if (reps.length === 1) {
    return reps[0];
  }

  // The card selector controls video resolution. Pair it with the best audio
  // track instead of showing a second, redundant quality dialog.
  if (selectedQuality) {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  }

  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"]));

  if (preference === "highest") {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  } else if (preference === "lowest") {
    return reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
  }

  return new Promise((resolve) => {

    const dialog = document.createElement("mdui-dialog");
    dialog.headline = browser.i18n.getMessage("audioQualityDialogTitle");

    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.setAttribute("for", "mpd-audio-select");
    label.textContent = browser.i18n.getMessage("audioQualitySelectLabel");;
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");
    select.setAttribute("id", "mpd-audio-select");

    select.value = "0";

    const sorted = reps.slice().sort((a, b) => a.bandwidth - b.bandwidth);

    sorted.forEach((r, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);
      const kbps = Math.round(r.bandwidth / 1000).toString();
      option.textContent = browser.i18n.getMessage("qualityBandwidth", [kbps]);
      select.appendChild(option);
    });

    content.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";
    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const idx = parseInt(select.value, 10) || 0;
      document.body.removeChild(dialog);

      resolve(sorted[idx]);
    });
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);

    requestAnimationFrame(() => { dialog.open = true; });
  });
}
