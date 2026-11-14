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



if (typeof browser === 'undefined') {
  var browser = chrome;
}

if (typeof browser !== 'undefined' && (!browser.i18n || !browser.i18n.getMessage)) {
  browser.i18n = browser.i18n || {};
  browser.i18n.getMessage = (key, subs) => {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      try { return chrome.i18n.getMessage(key, subs); } catch (e) {}
    }
    return "";
  };
}

const janjiMuatSkrip = new Map();
const WAKTU_TUNGGU_MUAT_SKRIP = 10000;

function golekiTagSkrip(urlMutlak) {
  for (const tag of document.scripts) {
    if (tag.src === urlMutlak) return tag;
  }
  return null;
}

function tungguPenandaSkrip(jenengGlobal, urlMutlak) {
  return new Promise((resolve, reject) => {
    if (typeof window[jenengGlobal] !== 'undefined') {
      resolve();
      return;
    }
    const wiwit = Date.now();
    const pemantau = setInterval(() => {
      if (typeof window[jenengGlobal] !== 'undefined') {
        clearInterval(pemantau);
        resolve();
      } else if (Date.now() - wiwit >= WAKTU_TUNGGU_MUAT_SKRIP) {
        clearInterval(pemantau);
        reject(new Error('Wektu entek ' + WAKTU_TUNGGU_MUAT_SKRIP + 'ms ngenteni window.' + jenengGlobal + ' teko ' + urlMutlak));
      }
    }, 50);
  });
}

function cobaMuatSkrip(src, urlMutlak, jenengGlobal, sisaNyoba) {
  if (golekiTagSkrip(urlMutlak)) {
    if (!jenengGlobal) return Promise.resolve();
    return tungguPenandaSkrip(jenengGlobal, urlMutlak);
  }
  return new Promise((resolve, reject) => {
    const skrip = document.createElement('script');
    skrip.async = false;
    skrip.src = urlMutlak;
    let rampung = false;
    const pewates = setTimeout(() => {
      if (rampung) return;
      rampung = true;
      skrip.remove();
      if (sisaNyoba > 0) {
        cobaMuatSkrip(src, urlMutlak, jenengGlobal, sisaNyoba - 1).then(resolve, reject);
      } else {
        reject(new Error('Wektu entek ' + WAKTU_TUNGGU_MUAT_SKRIP + 'ms muat ' + src));
      }
    }, WAKTU_TUNGGU_MUAT_SKRIP);
    skrip.onload = () => {
      if (rampung) return;
      rampung = true;
      clearTimeout(pewates);
      if (!jenengGlobal || typeof window[jenengGlobal] !== 'undefined') {
        resolve();
      } else {
        reject(new Error(src + ' ke-load nanging ora nge-set window.' + jenengGlobal + ' (modul class/const kudu nyetel penanda window.* dhewe)'));
      }
    };
    skrip.onerror = () => {
      if (rampung) return;
      rampung = true;
      clearTimeout(pewates);
      skrip.remove();
      if (sisaNyoba > 0) {
        cobaMuatSkrip(src, urlMutlak, jenengGlobal, sisaNyoba - 1).then(resolve, reject);
      } else {
        reject(new Error('Gagal muat script ' + src));
      }
    };
    document.head.appendChild(skrip);
  });
}

function ensureScriptLoaded(src, globalVarName) {
  if (globalVarName && typeof window[globalVarName] !== 'undefined') return Promise.resolve();
  const urlMutlak = browser.runtime.getURL(src);
  if (janjiMuatSkrip.has(urlMutlak)) return janjiMuatSkrip.get(urlMutlak);
  const janji = cobaMuatSkrip(src, urlMutlak, globalVarName, 1);
  janjiMuatSkrip.set(urlMutlak, janji);
  janji.catch(() => {
    if (janjiMuatSkrip.get(urlMutlak) === janji) janjiMuatSkrip.delete(urlMutlak);
  });
  return janji;
}

function muatSkripBerurutan(daftarSkrip) {
  let rantai = Promise.resolve();
  for (const [src, jenengGlobal] of daftarSkrip) {
    rantai = rantai.then(() => ensureScriptLoaded(src, jenengGlobal));
  }
  return rantai;
}

function isFlagEnabled(val, defaultVal = false) {
  if (val === undefined) return defaultVal;
  return val === '1' || val === 1 || val === true || val === 'true';
}

function nungguManifestHls(hlsInstance, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let rampung = false;
    const rampungno = (sukses) => {
      if (rampung) return;
      rampung = true;
      clearTimeout(timer);
      try { hlsInstance.off(Hls.Events.MANIFEST_PARSED, onParsed); } catch (_) {}
      try { hlsInstance.off(Hls.Events.ERROR, onError); } catch (_) {}
      if (!sukses) { try { hlsInstance.destroy(); } catch (_) {} }
      resolve(sukses);
    };
    const onParsed = () => rampungno(true);
    const onError = () => rampungno(false);
    const timer = setTimeout(() => rampungno(false), timeoutMs);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, onParsed);
    hlsInstance.on(Hls.Events.ERROR, onError);
  });
}

function escapeHtmlPopup(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
