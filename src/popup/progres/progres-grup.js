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



function aliasProgresGrup(data, el) {
  const metu = [];
  const tambah = (v) => { if (v !== undefined && v !== null && String(v) !== '') metu.push(String(v)); };
  tambah(data?.id);
  tambah(data?.jobId);
  tambah(data?.downloadId);
  tambah(data?.url);
  tambah(el?.dataset?.downloadId);
  tambah(el?.dataset?.url);
  return [...new Set(metu)];
}

function golekKunciProgresGrup(alias, el) {
  const daftar = (Array.isArray(alias) ? alias : [alias]).filter(a => a !== undefined && a !== null && String(a) !== '');
  for (const a of daftar) {
    const k = String(a);
    if (activeGroupDownloads.has(k)) return k;
  }
  for (const [k, v] of activeGroupDownloads) {
    if (el && v.el && v.el === el) return k;
    const aliasEntri = aliasProgresGrup(v, v.el);
    if (daftar.some(a => aliasEntri.includes(String(a)))) return k;
  }
  return null;
}

function simpenProgresGrup(data, el, groupTypeKuwat) {
  const alias = aliasProgresGrup(data, el);
  const kunciLawas = golekKunciProgresGrup(alias, el);
  const lawas = kunciLawas ? activeGroupDownloads.get(kunciLawas) : null;
  const groupType = (lawas?.groupType && !groupTypeKuwat) ? lawas.groupType : (data.groupType || lawas?.groupType || null);
  const kunci = kunciLawas || String(data.id || data.jobId || data.downloadId || data.url || '');
  if (!kunci) return { kunci: null, groupTypeLawas: new Set() };
  activeGroupDownloads.set(kunci, {
    id: kunci,
    jobId: data.jobId ?? lawas?.jobId ?? null,
    downloadId: data.downloadId ?? lawas?.downloadId ?? null,
    url: data.url ?? lawas?.url ?? null,
    groupType,
    filename: (data.filename && data.filename !== 'Media File') ? data.filename : (lawas?.filename ?? 'Media File'),
    percent: data.percent !== undefined ? data.percent : (lawas?.percent ?? null),
    indeterminate: data.indeterminate !== undefined ? !!data.indeterminate : !!lawas?.indeterminate,
    text: data.text ?? lawas?.text ?? '',
    isPaused: data.isPaused !== undefined ? !!data.isPaused : !!lawas?.isPaused,
    el: el || lawas?.el || null,
  });
  const groupTypeLawas = new Set();
  if (lawas?.groupType && lawas.groupType !== groupType) groupTypeLawas.add(lawas.groupType);
  return { kunci, groupTypeLawas };
}

function busakProgresGrup(alias, el) {
  const kena = new Set();
  const daftar = (Array.isArray(alias) ? alias : [alias]).filter(a => a !== undefined && a !== null && String(a) !== '');
  for (const [k, v] of [...activeGroupDownloads]) {
    const aliasEntri = aliasProgresGrup(v, v.el);
    const cocok = daftar.some(a => String(k) === String(a) || aliasEntri.includes(String(a))) || (el && v.el && v.el === el);
    if (!cocok) continue;
    if (v.groupType) kena.add(v.groupType);
    activeGroupDownloads.delete(k);
  }
  return kena;
}

const zipProgressPerJob = new Map();

function zipKanggoGrup(groupType) {
  const metu = [];
  for (const z of zipProgressPerJob.values()) {
    if (!z.groupType || z.groupType === groupType) metu.push(z);
  }
  return metu;
}

function updateGlobalProgressVisibility() {
  const gC = document.getElementById('global-progress-container');
  if (!gC) return;
  if (isGroupingEnabled && isGroupProgressEnabled && activeGroup === null) {
    gC.style.display = 'none';
  }
}


function syncZipProgressToGroupCards(text, percent, indeterminate, cancelCb, isPaused = false, pauseCb = null, groupType = null, jobId = null) {
  const kunciZip = String(jobId ?? '__zip__');
  const lawas = zipProgressPerJob.get(kunciZip);
  if (!groupType) {
    const gtSet = new Set();
    for (const [, entry] of activeGroupDownloads) { if (entry.groupType) gtSet.add(entry.groupType); }
    if (gtSet.size === 1) groupType = [...gtSet][0];
  }
  if (!groupType && lawas?.groupType) groupType = lawas.groupType;
  zipProgressPerJob.set(kunciZip, { text, percent, indeterminate, cancelCb, isPaused, pauseCb, groupType, jobId: jobId ?? lawas?.jobId ?? null });
  if (!isGroupingEnabled || !isGroupProgressEnabled || activeGroup !== null) return;
  if (groupType) {
    syncGroupProgressCard(groupType);
  } else {
    document.querySelectorAll('.media-group-card[data-group-type]').forEach(card => {
      syncGroupProgressCard(card.dataset.groupType);
    });
  }
}

function clearZipProgressFromGroupCards(jobId = null) {
  const kena = new Set();
  if (jobId !== null) {
    const z = zipProgressPerJob.get(String(jobId));
    if (!z) return;
    if (z.groupType) kena.add(z.groupType);
    zipProgressPerJob.delete(String(jobId));
  } else {
    for (const z of zipProgressPerJob.values()) { if (z.groupType) kena.add(z.groupType); }
    zipProgressPerJob.clear();
  }
  if (!isGroupingEnabled || !isGroupProgressEnabled || activeGroup !== null) return;
  if (kena.size > 0) {
    kena.forEach(syncGroupProgressCard);
  } else {
    document.querySelectorAll('.media-group-card[data-group-type]').forEach(card => {
      syncGroupProgressCard(card.dataset.groupType);
    });
  }
}
