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




let sudahMuatListAwal = false;
let setelanStrukturalPalingAnyar = null;
let butuhRefreshSelektifSawiseLoad = false;
const KUNCI_SETELAN_STRUKTURAL = ['group-by-type', 'manual-scan', 'manual-scan-keep-tabs', 'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file', 'hide-segments', 'disable-deduplication', 'min-file-size', 'min-file-size-custom', 'image-min-side', 'image-min-side-custom', 'image-min-file-size', 'image-min-file-size-custom', 'hide-image-without-size', 'media-sort-order', 'limit-media-list', 'limit-media-list-custom', 'optimize-low-end'];

function apakahItemCocokPanelusuran(item, lowerQuery) {
  if (!lowerQuery) return true;
  const { bestRequest } = item;
  const pageTitle = (bestRequest.pageTitle || '').toLowerCase();
  const headline = getFileName(bestRequest.originalUrl, 200).toLowerCase();
  const resolvedName = (item.resolvedFilename || '').toLowerCase();
  const url = (bestRequest.originalUrl || '').toLowerCase();
  const type = (item.type || '').toLowerCase();
  let hostname = '';
  try { hostname = new URL(bestRequest.originalUrl).hostname.toLowerCase(); } catch(e) {}
  return pageTitle.includes(lowerQuery) || headline.includes(lowerQuery) || resolvedName.includes(lowerQuery) || url.includes(lowerQuery) || hostname.includes(lowerQuery) || type.includes(lowerQuery);
}

function sidikJariItemMedia(item) {
  const r = item?.bestRequest || {};
  const ringkesanFormat = Array.isArray(r.ytFormats)
    ? r.ytFormats.map(f => `${f.itag || ''}:${f.width || ''}x${f.height || ''}:${f.label || ''}`).join(',')
    : '';
  const ringkesanSubtitle = Array.isArray(item?.ytSubtitles)
    ? item.ytSubtitles.map(s => `${s.displayName || s.language || ''}:${s.vttUrl || ''}`).join(',')
    : '';
  return [
    parseInt(r.size) || 0,
    item?.resolvedFilename || '',
    item?.type || '',
    Array.isArray(r.ytFormats) ? r.ytFormats.length : 0,
    ringkesanFormat,
    ringkesanSubtitle,
    r.pageTitle || '',
    item?.hasQuality ? 1 : 0,
    r.timeStamp || r.timestamp || 0,
    parseInt(r.imageWidth) || 0,
    parseInt(r.imageHeight) || 0
  ].join('|');
}

function busakKunciRenderSakaUrl(url, type = 'file') {
  if (!url) return;
  renderedMediaUrls.delete(url);
  renderedMediaUrls.delete(getMediaRenderKey(url, type));
  for (const p of ['video', 'stream', 'audio', 'file']) renderedMediaUrls.delete(`${p}:${url}`);
}

function busakKunciRender(el) {
  if (!el) return;
  const urls = [el.dataset?.url, el.dataset?.originalUrl].filter(Boolean);
  for (const u of urls) busakKunciRenderSakaUrl(u, el.dataset?.type || 'file');
}

let generasiModelMedia = 0;
let refreshSelektifKotor = false;
let refreshSelektifMlaku = false;
async function refreshListMediaSelektif() {
  if (refreshSelektifMlaku) { refreshSelektifKotor = true; return; }
  if (!sudahMuatListAwal) { loadMediaList().catch(() => {}); return; }
  if (document.getElementById('navbar')?.value !== 'home' || document.visibilityState !== 'visible') return;
  if (mediaListLoad) { butuhRefreshSelektifSawiseLoad = true; return; }
  refreshSelektifMlaku = true;
  const generasiSadurunge = generasiModelMedia;
  try {
    const { mediaRequests, settings, currentActiveTabId, currentActiveHost } = await ambilDataMediaMentah();
    if (setelanStrukturalPalingAnyar && KUNCI_SETELAN_STRUKTURAL.some(k => String(settings[k] ?? '') !== String(setelanStrukturalPalingAnyar[k] ?? ''))) {
      loadMediaList().catch(() => {});
      return;
    }
    let activeDownloads = activeDownloadSnapshot || {};
    const activeDownloadsPromise = getActiveDownloadSnapshot();
    const quickActiveDownloads = await Promise.race([activeDownloadsPromise, new Promise(resolve => setTimeout(() => resolve(null), 100))]);
    if (quickActiveDownloads) activeDownloads = quickActiveDownloads;
    const { items: itemsBaru } = await hitungDaftarMediaBaru(mediaRequests, settings, currentActiveTabId, currentActiveHost, kumpulkanActiveItems(), activeDownloads);
    if (generasiModelMedia !== generasiSadurunge || mediaListLoad) {
      if (mediaListLoad) butuhRefreshSelektifSawiseLoad = true;
      return;
    }
    terapnoSelisihDaftarMedia(itemsBaru);
  } catch (e) {
    console.warn('[website-media-downloader] Refresh selektif gagal, list lawas dipertahanno:', e);
  } finally {
    refreshSelektifMlaku = false;
    if (refreshSelektifKotor) { refreshSelektifKotor = false; refreshListMediaSelektif().catch(() => {}); }
  }
}

function kartuLagiDipake(el) {
  if (!el) return false;
  if (el.classList.contains('expanded')) return true;
  if (el.dataset?.url && el.dataset?.originalUrl && el.dataset.url !== el.dataset.originalUrl) return true;
  return false;
}

function selarasnoSeleksi(modelLawas, modelAnyar) {
  if (!selectedUrls || selectedUrls.size === 0) return;
  const kunciLawasKanggoUrl = new Map();
  for (const item of modelLawas || []) {
    const url = item?.bestRequest?.originalUrl || '';
    if (!url || kunciLawasKanggoUrl.has(url)) continue;
    kunciLawasKanggoUrl.set(url, getMediaRenderKey(url, item?.type || 'file'));
  }
  const urlAnyarKanggoKunci = new Map();
  const urlAnyarKabeh = new Set();
  for (const item of modelAnyar || []) {
    const url = item?.bestRequest?.originalUrl || '';
    if (!url) continue;
    urlAnyarKabeh.add(url);
    const kunci = getMediaRenderKey(url, item?.type || 'file');
    if (!urlAnyarKanggoKunci.has(kunci)) urlAnyarKanggoKunci.set(kunci, url);
  }
  for (const url of [...selectedUrls]) {
    if (urlAnyarKabeh.has(url)) continue;
    const kunci = kunciLawasKanggoUrl.get(url);
    selectedUrls.delete(url);
    const urlAnyar = kunci ? urlAnyarKanggoKunci.get(kunci) : undefined;
    if (urlAnyar) selectedUrls.add(urlAnyar);
  }
}

function terapnoSelisihDaftarMedia(itemsBaru) {
  const mediaContainer = document.getElementById('media-list');
  if (!mediaContainer) return;
  const query = document.getElementById('search-bar')?.value.trim() || '';
  const lowerQuery = query.toLowerCase();
  const isSearching = !!lowerQuery;

  const kunciSakaItem = (item) => {
    const url = item?.bestRequest?.originalUrl || item?.bestRequest?.url || '';
    return url ? getMediaRenderKey(url, item?.type || 'file') : '';
  };

  const lawasMiturutKunci = new Map();
  for (const item of allMediaRequests) {
    if (item.downloadId !== undefined) continue;
    const kunci = kunciSakaItem(item);
    if (kunci) lawasMiturutKunci.set(kunci, item);
  }
  const anyarMiturutKunci = new Map();
  for (const item of itemsBaru) {
    if (item.downloadId !== undefined) continue;
    const kunci = kunciSakaItem(item);
    if (kunci) anyarMiturutKunci.set(kunci, item);
  }

  selarasnoSeleksi(allMediaRequests, itemsBaru);
  allMediaRequests = itemsBaru;
  allFilteredRequests = isSearching
    ? itemsBaru.filter(item => apakahItemCocokPanelusuran(item, lowerQuery))
    : [...itemsBaru];
  generasiModelMedia++;

  if (isGroupingEnabled && activeGroup === null && !isSearching) {
    const hitungan = getGroupCounts([...activeDownloadingElements]);
    const tipeAnyar = Object.keys(hitungan).filter(t => hitungan[t] > 0);
    const kartuGrup = [...mediaContainer.querySelectorAll('.media-group-card[data-group-type]')].map(el => el.dataset.groupType);
    const tipeBerubah = tipeAnyar.length !== kartuGrup.length || tipeAnyar.some(t => !kartuGrup.includes(t));
    if (tipeBerubah) { loadMediaList().catch(() => {}); return; }
    segarkanHitunganGrup();
    return;
  }

  const kartuMiturutKunci = new Map();
  mediaContainer.querySelectorAll('.media-item').forEach(el => {
    if (el.querySelector('mdui-linear-progress')) return;
    if (el.dataset.downloadId) return;
    const kunci = getMediaRenderKey(el.dataset.originalUrl || el.dataset.url || '', el.dataset.type || 'file');
    if (kunci) kartuMiturutKunci.set(kunci, el);
  });

  const katon = getActiveRequests().filter(item => item.downloadId === undefined && (!isSearching || apakahItemCocokPanelusuran(item, lowerQuery)));
  const indeksKaton = new Map();
  katon.forEach((item, i) => {
    const kunci = kunciSakaItem(item);
    if (kunci) indeksKaton.set(kunci, i);
  });

  if (renderedCount === 0 && mediaContainer.querySelectorAll('.media-item').length === 0 && katon.length > 0) {
    loadMediaList().catch(() => {});
    return;
  }

  function golekAnchorSisipan(indeks) {
    for (let i = indeks + 1; i < katon.length; i++) {
      const el = kartuMiturutKunci.get(kunciSakaItem(katon[i]));
      if (el) return el;
    }
    return null;
  }
  function sisipnoKartuMiturutUrutan(kartu, indeks) {
    const anchor = golekAnchorSisipan(indeks);
    const sentinel = document.getElementById('infinite-scroll-sentinel');
    const endMsg = document.getElementById('end-of-media-list');
    if (anchor) mediaContainer.insertBefore(kartu, anchor);
    else if (sentinel) mediaContainer.insertBefore(kartu, sentinel);
    else if (endMsg) mediaContainer.insertBefore(kartu, endMsg);
    else mediaContainer.appendChild(kartu);
  }

  let jumlahKartuDibusak = 0;
  for (const [kunci, el] of [...kartuMiturutKunci]) {
    if (!anyarMiturutKunci.has(kunci) || !indeksKaton.has(kunci)) {
      el.remove();
      kartuMiturutKunci.delete(kunci);
      busakKunciRender(el);
      if (el.dataset?.url) uiCache.delete(el.dataset.url);
      if (el.dataset?.originalUrl) uiCache.delete(el.dataset.originalUrl);
      renderedCount = Math.max(0, renderedCount - 1);
      indeksChunkSabanjure = Math.max(0, indeksChunkSabanjure - 1);
      jumlahKartuDibusak++;
    }
  }

  for (const [kunci, itemAnyar] of anyarMiturutKunci) {
    const el = kartuMiturutKunci.get(kunci);
    if (!el || !indeksKaton.has(kunci)) continue;
    const itemLawas = lawasMiturutKunci.get(kunci);
    if (itemLawas && sidikJariItemMedia(itemLawas) !== sidikJariItemMedia(itemAnyar)) {
      if (kartuLagiDipake(el)) continue;
      let kartuAnyar;
      try {
        kartuAnyar = createMediaItem(itemAnyar);
      } catch (e) {
        console.error('[website-media-downloader] Skip item media rusak pas refresh selektif:', itemAnyar?.bestRequest?.originalUrl, e);
        continue;
      }
      el.replaceWith(kartuAnyar);
      kartuMiturutKunci.set(kunci, kartuAnyar);
      sisipnoKartuMiturutUrutan(kartuAnyar, indeksKaton.get(kunci));
    }
  }

  const jumlahModelUnduhan = getActiveRequests().filter(item => item.downloadId !== undefined).length;
  const batasKaton = Math.max(0, renderedCount - jumlahModelUnduhan);
  const pesenKosong = mediaContainer.querySelector('.no-media-container');
  const pesenOraCocok = mediaContainer.querySelector('#no-matches-msg');
  for (const [kunci, itemAnyar] of anyarMiturutKunci) {
    if (kartuMiturutKunci.has(kunci)) continue;
    const indeks = indeksKaton.get(kunci);
    if (indeks === undefined) continue;
    if (indeks >= batasKaton) continue;
    let kartuAnyar;
    try {
      kartuAnyar = createMediaItem(itemAnyar);
    } catch (e) {
      console.error('[website-media-downloader] Skip item media rusak pas refresh selektif:', itemAnyar?.bestRequest?.originalUrl, e);
      continue;
    }
    if (pesenKosong) pesenKosong.remove();
    if (pesenOraCocok) pesenOraCocok.remove();
    sisipnoKartuMiturutUrutan(kartuAnyar, indeks);
    renderedMediaUrls.add(itemAnyar.bestRequest.originalUrl);
    renderedMediaUrls.add(kunci);
    renderedCount++;
    kartuMiturutKunci.set(kunci, kartuAnyar);
  }

  if (mediaContainer.querySelectorAll('.media-item').length === 0 && mediaContainer.querySelectorAll('.media-group-card').length === 0) {
    mediaContainer.innerHTML = isSearching
      ? `<div id="no-matches-msg" style="padding: 60px 20px; text-align: center; opacity: 0.8;">No matches found for "${escapeHtmlPopup(query)}"</div>`
      : getNoMediaDetectedHTML();
    updateSelectedCount();
    return;
  }
  if (jumlahKartuDibusak > 0) renderNextChunk();
  updateSelectedCount();
}
