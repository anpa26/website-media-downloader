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


async function selectStreamVariant(playlistLines, baseUrl, options = {}, selectedQuality = null) {
  const variants = [];

  for (let i = 0; i < playlistLines.length; i++) {
    if (playlistLines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bwMatch = playlistLines[i].match(/BANDWIDTH=(\d+)/);
      const resMatch = playlistLines[i].match(/RESOLUTION=(\d+x\d+)/);
      const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
      const resolution = resMatch ? resMatch[1] : "unknown";
      const uri = playlistLines[i + 1];
        variants.push({
        bandwidth,
        resolution,
        uri: uri.startsWith("http") ? uri : baseUrl + uri
      });
    }
  }

  if (variants.length === 0) return null;

  const urlParams = new URLSearchParams(window.location.search);
  const targetQuality = selectedQuality || urlParams.get('quality');
  if (targetQuality) {
      let match = null;
      if (targetQuality === 'highest' || targetQuality === 'best') {
          match = variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
      } else if (targetQuality === 'lowest') {
          match = variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
      } else {
          if (targetQuality.includes('@')) {
              const parts = targetQuality.split('@');
              const res = parts[0];
              const bw = parseInt(parts[1], 10);
              match = variants.find(v => v.resolution === res && v.bandwidth === bw);
          }
          if (!match) {
              match = variants.find(v => v.resolution === targetQuality || v.bandwidth.toString() === targetQuality);
          }
      }
      if (match) {
          try {
              const res = await fetchWithCache(match.uri, options);
              const text = await res.text();
              const duration = text.split('\n')
                .filter(line => line.startsWith("#EXTINF:"))
                .map(line => parseFloat(line.replace("#EXTINF:", "")))
                .reduce((sum, dur) => sum + dur, 0);

              match.estimatedSize = (match.bandwidth * duration) / 8;
              match.duration = duration;
          } catch (e) {
              console.warn("Could not fetch duration for pre-selected variant", match.uri);
              match.estimatedSize = null;
          }
          return match;
      }
  }

  await Promise.all(variants.map(async (variant) => {
    try {
      const res = await fetchWithCache(variant.uri, options);
      const text = await res.text();
      const duration = text.split('\n')
        .filter(line => line.startsWith("#EXTINF:"))
        .map(line => parseFloat(line.replace("#EXTINF:", "")))
        .reduce((sum, dur) => sum + dur, 0);

      const estimatedSize = (variant.bandwidth * duration) / 8;
      variant.estimatedSize = estimatedSize;
      variant.duration = duration;
    } catch (e) {
      console.warn("Could not fetch duration for", variant.uri);
      variant.estimatedSize = null;
    }
  }));

  if (variants.length === 1) return variants[0];

  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"]));
  if (preference === "highest") return variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  if (preference === "lowest") return variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));

  return new Promise((resolve) => {
    const dialog = document.createElement("mdui-dialog");
    dialog.headline = browser.i18n.getMessage("streamQualityDialogTitle")

    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.textContent = browser.i18n.getMessage("streamQualitySelectLabel")
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");

    variants.forEach((v, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);
      const bandwidthKbps = Math.round(v.bandwidth / 1000).toString();
      const humanSize = getHumanReadableSize(v.estimatedSize) || "Size N/A";
      option.textContent = browser.i18n.getMessage("qualityResolutionBandwidthSize", [v.resolution, bandwidthKbps, humanSize]) || `${v.resolution} (${bandwidthKbps} kbps, ${humanSize})`;
      select.appendChild(option);
    });

    content.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";

    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const selectedIndex = select.value || 0;
      document.body.removeChild(dialog);
      resolve(variants[selectedIndex]);
    });

    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);

    document.body.appendChild(dialog);
    requestAnimationFrame(() => dialog.open = true);
  });
}
