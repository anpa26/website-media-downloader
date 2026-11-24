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



const navigationPageLoads = new Map();
const navigationSkeletonsShown = new Set();
let fragmentPengaturanDimuat = false;
async function ambilTeksFragmentPengaturan() {
  const tanggapan = await fetch(browser.runtime.getURL('pages/settings-fragment.html'));
  if (!tanggapan.ok) throw new Error('Gagal muat fragment pengaturan: ' + tanggapan.status);
  return tanggapan.text();
}

const POLA_BUKA_WADAH_SETELAN = /<div class="settings-items-container(?:\s[^"]*)?">/g;
const isiSeksiPengaturan = [];
const janjiMuatSeksi = new Map();
let pengamatSeksiPengaturan = null;
let antreSeksiPengaturan = [];
let lagiMuatAntreSeksi = false;

function cariTutupWadahSetelan(teks, awalIsi) {
  let dalam = 1;
  let i = awalIsi;
  while (i < teks.length && dalam > 0) {
    const buka = teks.indexOf('<div', i);
    const tutup = teks.indexOf('</div>', i);
    if (tutup < 0) return -1;
    if (buka >= 0 && buka < tutup) {
      dalam++;
      i = buka + 4;
    } else {
      dalam--;
      if (dalam === 0) return tutup;
      i = tutup + 6;
    }
  }
  return -1;
}

function pisahIsiSeksi(grupHtml) {
  const isi = [];
  let cangkang = '';
  let pos = 0;
  while (true) {
    POLA_BUKA_WADAH_SETELAN.lastIndex = pos;
    const cocok = POLA_BUKA_WADAH_SETELAN.exec(grupHtml);
    if (!cocok) {
      cangkang += grupHtml.slice(pos);
      break;
    }
    const awal = cocok.index;
    const awalIsi = awal + cocok[0].length;
    const tutup = cariTutupWadahSetelan(grupHtml, awalIsi);
    if (tutup < 0) {
      cangkang += grupHtml.slice(pos);
      break;
    }
    cangkang += grupHtml.slice(pos, awalIsi) + '</div>';
    isi.push(grupHtml.slice(awalIsi, tutup));
    pos = tutup + 6;
  }
  return { cangkang, isi };
}

function pecahSeksiPengaturan(teks) {
  const awal = [];
  let cari = 0;
  while (true) {
    const ketemu = teks.indexOf('<div class="settings-group">', cari);
    if (ketemu < 0) break;
    awal.push(ketemu);
    cari = ketemu + 1;
  }
  const seksi = [];
  for (let i = 0; i < awal.length; i++) {
    const akhir = i + 1 < awal.length ? awal[i + 1] : teks.length;
    seksi.push(teks.slice(awal[i], akhir));
  }
  return seksi;
}

function pasangIsiSeksi(grup, indeks) {
  const isi = isiSeksiPengaturan[indeks] || [];
  const wadah = grup.querySelectorAll('.settings-items-container');
  wadah.forEach((siji, i) => {
    if (isi[i] !== undefined) siji.innerHTML = isi[i];
  });
}

async function muatIsiSeksi(indeks) {
  const wadahSetelan = document.getElementById('settings-container');
  if (!wadahSetelan) return false;
  const grup = wadahSetelan.querySelectorAll('.settings-group')[indeks];
  if (!grup) return false;
  if (grup.dataset.seksiDimuat === '1') return true;
  if (janjiMuatSeksi.has(indeks)) return janjiMuatSeksi.get(indeks);
  const janji = (async () => {
    const isi = isiSeksiPengaturan[indeks];
    if (!isi || isi.length === 0) {
      grup.dataset.seksiDimuat = '1';
      return true;
    }
    pasangIsiSeksi(grup, indeks);
    if (typeof window.mdu_translate === 'function') window.mdu_translate(grup);
    if (typeof window.siapnoSeksi === 'function') await window.siapnoSeksi(grup);
    grup.dataset.seksiDimuat = '1';
    return true;
  })();
  janjiMuatSeksi.set(indeks, janji);
  try {
    await janji;
  } catch (galat) {
    janjiMuatSeksi.delete(indeks);
    throw galat;
  }
  return true;
}
window.muatIsiSeksi = muatIsiSeksi;

function seksiKaton(grup) {
  if (grup.classList.contains('collapsed')) return false;
  const wadahSetelan = document.getElementById('settings-container');
  if (!wadahSetelan) return true;
  if (wadahSetelan.classList.contains('layout-tabs')) return grup.classList.contains('active-tab-group');
  if (wadahSetelan.classList.contains('layout-sidebar')) return grup.classList.contains('active-sidebar-group');
  return true;
}

function olahAntreSeksiPengaturan() {
  if (lagiMuatAntreSeksi) return;
  lagiMuatAntreSeksi = true;
  const langkah = () => {
    const indeks = antreSeksiPengaturan.shift();
    if (indeks === undefined) {
      lagiMuatAntreSeksi = false;
      return;
    }
    muatIsiSeksi(indeks).catch(() => {}).finally(() => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(langkah, { timeout: 750 });
      else setTimeout(langkah, 75);
    });
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(langkah, { timeout: 750 });
  else setTimeout(langkah, 75);
}

function amatiSeksiPengaturan() {
  const wadahSetelan = document.getElementById('settings-container');
  if (!wadahSetelan || pengamatSeksiPengaturan) return;
  if (typeof IntersectionObserver === 'undefined') return;
  pengamatSeksiPengaturan = new IntersectionObserver((entri) => {
    entri.forEach((entriSiji) => {
      if (!entriSiji.isIntersecting) return;
      const grup = entriSiji.target;
      const indeks = Number(grup.dataset.indeksSeksi);
      if (grup.dataset.seksiDimuat === '1') return;
      if (!antreSeksiPengaturan.includes(indeks)) antreSeksiPengaturan.push(indeks);
      olahAntreSeksiPengaturan();
    });
  }, { rootMargin: '400px' });
  wadahSetelan.querySelectorAll('.settings-group').forEach((grup, indeks) => {
    grup.dataset.indeksSeksi = String(indeks);
    if (indeks === 0) return;
    if ((isiSeksiPengaturan[indeks] || []).length === 0) {
      grup.dataset.seksiDimuat = '1';
      return;
    }
    pengamatSeksiPengaturan.observe(grup);
  });
}

async function muatSeksiNgantiGulir(target) {
  const wadahSetelan = document.getElementById('settings-container');
  if (!wadahSetelan || target <= 0) return;
  const grup = wadahSetelan.querySelectorAll('.settings-group');
  for (let i = 1; i < grup.length; i++) {
    if (document.documentElement.scrollHeight >= target + window.innerHeight) return;
    if (grup[i].dataset.seksiDimuat === '1') continue;
    if (!seksiKaton(grup[i])) continue;
    await muatIsiSeksi(i);
  }
}
function showNavigationSkeleton(tab) {
  if (tab === 'settings') return;
  if (navigationSkeletonsShown.has(tab)) return;
  const target = tab === 'home'
    ? document.getElementById('media-list')
    : tab === 'history'
      ? document.getElementById('history-list')
      : tab === 'about'
        ? document.getElementById('about-container')
        : document.getElementById('settings-container');
  if (!target) return;
  navigationSkeletonsShown.add(tab);
  target.classList.add('tab-content-loading');
  const skeleton = document.createElement('div');
  skeleton.className = 'tab-skeleton';
  skeleton.innerHTML = '<div class="tab-skeleton-card"></div>'.repeat(tab === 'settings' ? 5 : 4);
  target.prepend(skeleton);
}

function hideNavigationSkeleton(tab) {
  const target = tab === 'home'
    ? document.getElementById('media-list')
    : tab === 'history'
      ? document.getElementById('history-list')
      : tab === 'about'
        ? document.getElementById('about-container')
        : document.getElementById('settings-container');
  if (!target) return;
  target.querySelector(':scope > .tab-skeleton')?.remove();
  target.classList.remove('tab-content-loading');
}

function loadNavigationPageOnce(tab, loader) {
  if (navigationPageLoads.has(tab)) return navigationPageLoads.get(tab);
  showNavigationSkeleton(tab);
  const loadPromise = Promise.resolve()
    .then(loader)
    .catch(error => {
      navigationPageLoads.delete(tab);
      throw error;
    })
    .finally(() => hideNavigationSkeleton(tab));
  navigationPageLoads.set(tab, loadPromise);
  return loadPromise;
}

function refreshNavbarLayout(navbar) {
  if (!navbar) return;
  requestAnimationFrame(() => {
    if (typeof navbar.requestUpdate === 'function') navbar.requestUpdate();
    window.dispatchEvent(new Event('resize'));
    const currentValue = navbar.value;
    navbar.value = '';
    requestAnimationFrame(() => { navbar.value = currentValue; });
  });
}
let currentNavigationTab = 'home';
function saveNavigationScroll(tab = currentNavigationTab) {
  if (tab) sessionStorage.setItem(`scrollPos:${tab}`, String(window.scrollY || 0));
}
function restoreNavigationScroll(tab) {
  const target = parseInt(sessionStorage.getItem(`scrollPos:${tab}`) || '0', 10);
  let attempts = 0;
  return new Promise(selesai => {
    const restore = () => {
      if (currentNavigationTab !== tab) { selesai(); return; }
      window.scrollTo(0, target);
      if (window.scrollY >= target || attempts++ >= 8) { selesai(); return; }
      setTimeout(restore, 50);
    };
    if (tab === 'settings' && target > 0) {
      muatSeksiNgantiGulir(target).catch(() => {}).finally(() => requestAnimationFrame(restore));
    } else {
      requestAnimationFrame(restore);
    }
  });
}

async function balikNangHome() {
  const wisAnaHome = navigationPageLoads.has('home');
  await activateNavigationTab('home');
  await restoreNavigationScroll('home');
  if (!wisAnaHome) return 'muat-penuh';
  const status = await jalankanCatchUpHome();
  if (status === 'muat-penuh') await restoreNavigationScroll('home');
  return status;
}
let historyPageInitialized = false;
function initializeHistoryPage() {
  if (historyPageInitialized) return;
  historyPageInitialized = true;
  document.getElementById('clear-history').addEventListener('click', () => clearHistory());
  document.getElementById('export-history').addEventListener('click', () => exportHistory());
  document.getElementById('import-history').addEventListener('click', () => {
    document.getElementById('import-history-input').click();
  });
  document.getElementById('import-history-input').addEventListener('change', handleImportHistory);
  pasangGolekRiwayat();
}
async function activateNavigationTab(tab) {
  if (tab === 'settings') {
    return loadNavigationPageOnce(tab, async () => {
      const wadahSetelan = document.getElementById('settings-container');
      if (!wadahSetelan) throw new Error('Wadah pengaturan ora ketemu');
      wadahSetelan.classList.add('tanpa-animasi');
      try {
        if (!fragmentPengaturanDimuat) {
          const janjiTeksFragment = ambilTeksFragmentPengaturan();
          const janjiTataLetakAwal = ensureScriptLoaded('settings/tampilan/tata-letak.js')
            .then(() => bacaTataLetakTersimpen())
            .catch(() => null);
          const janjiNilaiAwal = ensureScriptLoaded('settings/state.js')
            .then(() => browser.storage.local.get(SETTINGS_KEYS))
            .catch(() => null);
          const [teksFragment, tataLetakAwal, nilaiAwal] = await Promise.all([janjiTeksFragment, janjiTataLetakAwal, janjiNilaiAwal]);
          const seksi = pecahSeksiPengaturan(teksFragment);
          const awalSeksi = teksFragment.indexOf('<div class="settings-group">');
          const pendahulu = awalSeksi < 0 ? teksFragment : teksFragment.slice(0, awalSeksi);
          const cangkang = seksi.map(grupHtml => {
            const pisah = pisahIsiSeksi(grupHtml);
            isiSeksiPengaturan.push(pisah.isi);
            return pisah.cangkang;
          });
          wadahSetelan.innerHTML = seksi.length ? pendahulu + cangkang.join('') : teksFragment;
          const grupKaping = wadahSetelan.querySelectorAll('.settings-group');
          if (grupKaping[0]) {
            pasangIsiSeksi(grupKaping[0], 0);
            grupKaping[0].dataset.seksiDimuat = '1';
          }
          if (typeof window.mdu_translate === 'function') window.mdu_translate(wadahSetelan);
          if (nilaiAwal && typeof terapnoNilaiAwalSetelan === 'function') terapnoNilaiAwalSetelan(nilaiAwal, grupKaping[0] || undefined);
          if (tataLetakAwal && typeof applySettingsLayout === 'function') {
            applySettingsLayout(tataLetakAwal);
            window.tataLetakSetelanAktif = tataLetakAwal;
          }
          fragmentPengaturanDimuat = true;
        }
        await ensureScriptLoaded('entries/settings.js', 'initializeSettingsPage');
        await window.initializeSettingsPage();
        amatiSeksiPengaturan();
        document.getElementById('pesen-gagal-settings')?.remove();
      } catch (error) {
        const wadahPengaturan = document.getElementById('settings-container');
        if (wadahPengaturan && !document.getElementById('pesen-gagal-settings')) {
          const pesenGagal = document.createElement('div');
          pesenGagal.id = 'pesen-gagal-settings';
          pesenGagal.style.cssText = 'padding: 40px 20px; text-align: center;';
          pesenGagal.innerHTML = 'Failed to load Settings. <button id="tombol-coba-maneh-settings" type="button">Coba lagi</button>';
          wadahPengaturan.prepend(pesenGagal);
          document.getElementById('tombol-coba-maneh-settings').addEventListener('click', () => {
            navigationPageLoads.delete('settings');
            activateNavigationTab('settings').catch((galat) => console.error(galat));
          });
        }
        throw error;
      } finally {
        wadahSetelan.offsetHeight;
        wadahSetelan.classList.remove('tanpa-animasi');
      }
    });
  }
  if (tab === 'about') {
    return loadNavigationPageOnce(tab, async () => {
      try {
        await ensureScriptLoaded('popup/about.js', 'loadAboutPage');
        await window.loadAboutPage();
      } catch (error) {
        const wadahAbout = document.getElementById('about-container');
        if (wadahAbout) wadahAbout.innerHTML = '<div style="padding: 40px; text-align: center;">' + (browser.i18n.getMessage('failedToLoadAbout') || 'Failed to load About page information.') + '</div>';
        throw error;
      }
    });
  }
  if (tab === 'history') {
    return loadNavigationPageOnce(tab, async () => {
      try {
        await ensureScriptLoaded('popup/riwayat.js', 'loadHistoryList');
        initializeHistoryPage();
        await window.loadHistoryList();
      } catch (error) {
        const wadahRiwayat = document.getElementById('history-list');
        if (wadahRiwayat) wadahRiwayat.innerHTML = '<div style="padding: 60px 20px; text-align: center;">Failed to load History.</div>';
        throw error;
      }
    });
  }
  if (tab === 'home') {
    if (!navigationPageLoads.has(tab)) activeGroup = null;
    return loadNavigationPageOnce(tab, loadMediaList);
  }
}

function waitForNavigationIdle() {
  return new Promise(resolve => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: 750 });
    } else {
      setTimeout(resolve, 75);
    }
  });
}

async function warmNavigationTabs(initialTab) {
  const warmOrder = ['history', 'about', 'settings', 'home'];
  for (const tab of warmOrder) {
    if (tab === initialTab || navigationPageLoads.has(tab)) continue;
    await waitForNavigationIdle();
    try {
      await activateNavigationTab(tab);
    } catch (error) {
      console.warn(`Failed to warm ${tab} tab:`, error);
    }
  }
}
