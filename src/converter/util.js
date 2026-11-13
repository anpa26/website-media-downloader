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


const optionalLibraryLoads = new Map();

function tampilnoNotif(pesen, opsi = {}) {
  if (pesen === undefined || pesen === null || pesen === '') return;
  if (!document.body) return;
  let el = document.getElementById('wmd-notif');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wmd-notif';
    el.className = 'wmd-notif';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = '';
  const teks = document.createElement('span');
  teks.className = 'wmd-notif-teks';
  teks.textContent = String(pesen);
  el.appendChild(teks);
  if (opsi.aksi && opsi.aksi.label && typeof opsi.aksi.lakokno === 'function') {
    const tombol = document.createElement('button');
    tombol.type = 'button';
    tombol.className = 'wmd-notif-aksi';
    tombol.textContent = String(opsi.aksi.label);
    tombol.addEventListener('click', () => {
      try { opsi.aksi.lakokno(); } catch (_) {}
      el.classList.remove('tampil');
    });
    el.appendChild(tombol);
  }
  el.classList.add('tampil');
  if (el._wmdNotifTimer) clearTimeout(el._wmdNotifTimer);
  const durasi = opsi.durasi === undefined ? 5000 : opsi.durasi;
  if (durasi > 0) {
    el._wmdNotifTimer = setTimeout(() => {
      el.classList.remove('tampil');
      el._wmdNotifTimer = null;
    }, durasi);
  } else {
    el._wmdNotifTimer = null;
  }
}



function ensureOptionalLibraryLoaded(src, globalName) {
  if (globalThis[globalName] !== undefined) return Promise.resolve();
  if (optionalLibraryLoads.has(src)) return optionalLibraryLoads.get(src);

  const load = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = browser.runtime.getURL(src);
    script.onload = () => globalThis[globalName] !== undefined
      ? resolve()
      : reject(new Error(`${src} loaded without exposing ${globalName}`));
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  }).catch(error => {
    optionalLibraryLoads.delete(src);
    throw error;
  });

  optionalLibraryLoads.set(src, load);
  return load;
}

const ensureClientZipLoaded = () => ensureOptionalLibraryLoaded('libraries/client-zip.js', 'downloadZip');
const ensureMuxJsLoaded = () => ensureOptionalLibraryLoaded('libraries/mux.js', 'muxjs');

function getHumanReadableSize(size) {
  const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
  let sizeInBytes = parseInt(size);
  if (isNaN(sizeInBytes)) return browser.i18n.getMessage("unknownSize") || "Unknown Size";
  let i = 0;
  while (sizeInBytes > 1024 && i < units.length - 1) { sizeInBytes /= 1024; i++; }
  return `${sizeInBytes.toFixed(2)} ${units[i]}`;
}
