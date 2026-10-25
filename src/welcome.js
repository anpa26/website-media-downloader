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

(function () {
  const STORAGE_KEY = 'wmd_welcome_shown';
  const REINSTALL_WARNING_KEY = 'wmd_reinstall_warning_shown';
  const LEARN_URL   = 'https://wmd.devianproject.tech/features?learn=all';

  const _browser = (typeof browser !== 'undefined') ? browser : chrome;

  function applyReinstallDescription(changelog) {
    const description = document.getElementById('reinstall-description');
    if (!description) return;
    const lang = _browser.i18n.getUILanguage().split('-')[0];
    const content = changelog[lang] || changelog.en;
    description.textContent = content?.reinstall_description || '';
  }

  function showWelcomePopup() {
    const overlay = document.getElementById('welcome-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
  }

  function dismissWelcomePopup() {
    const overlay = document.getElementById('welcome-overlay');
    const card    = document.getElementById('welcome-card');
    if (!overlay) return;

    card.style.animation = 'wCardZoomOut 0.25s cubic-bezier(0.36,0.07,0.19,0.97) forwards';
    setTimeout(() => {
      overlay.style.display = 'none';
      card.style.animation  = '';
      checkReinstallRequirementAfterOnboarding();
    }, 300);

    try {
      const result = _browser.storage.local.set({ [STORAGE_KEY]: '1' });
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (e) {}
  }

  async function checkReinstallRequirementAfterOnboarding() {
    try {
      const data = await _browser.storage.local.get([REINSTALL_WARNING_KEY, 'wmd_previous_version']);
      const res = await fetch(_browser.runtime.getURL('changelog.json'));
      const changelog = await res.json();
      applyReinstallDescription(changelog);
      
      if (changelog.require_uninstall && data['wmd_previous_version'] && !data[REINSTALL_WARNING_KEY]) {
        setTimeout(showReinstallPopup, 300);
      }
    } catch (e) {
      console.error("Failed to check reinstall after onboarding:", e);
    }
  }

  const welcomeIconImg = document.getElementById('welcome-icon-img');
  if (welcomeIconImg) {
    welcomeIconImg.addEventListener('error', function () {
      this.style.display = 'none';
      if (this.parentElement) {
        this.parentElement.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
      }
    });
  }

  document.getElementById('welcome-learn-btn').addEventListener('click', () => {
    dismissWelcomePopup();
    _browser.tabs.create({ url: LEARN_URL });
  });

  document.getElementById('welcome-dismiss-btn').addEventListener('click', () => {
    dismissWelcomePopup();
  });

  document.getElementById('welcome-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('welcome-overlay')) {
      dismissWelcomePopup();
    }
  });

  // Reinstall Popup Functions
  function showReinstallPopup() {
    const overlay = document.getElementById('reinstall-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
  }

  function dismissReinstallPopup() {
    const overlay = document.getElementById('reinstall-overlay');
    const card    = document.getElementById('reinstall-card');
    if (!overlay) return;

    card.style.animation = 'wCardZoomOut 0.25s cubic-bezier(0.36,0.07,0.19,0.97) forwards';
    setTimeout(() => {
      overlay.style.display = 'none';
      card.style.animation  = '';
    }, 300);

    try {
      const result = _browser.storage.local.set({ [REINSTALL_WARNING_KEY]: '1' });
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (e) {}
  }

  const reinstallActionBtn = document.getElementById('reinstall-action-btn');
  if (reinstallActionBtn) {
    reinstallActionBtn.addEventListener('click', () => {
      dismissReinstallPopup();
      const isFirefox = navigator.userAgent.includes('Firefox') || (typeof _browser !== 'undefined' && _browser.runtime.getURL && _browser.runtime.getURL('').startsWith('moz-extension://'));
      const storeUrl = isFirefox 
        ? 'https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader'
        : 'https://wmd.devianproject.tech/';
      _browser.tabs.create({ url: storeUrl });
    });
  }

  const reinstallSkipBtn = document.getElementById('reinstall-skip-btn');
  if (reinstallSkipBtn) {
    reinstallSkipBtn.addEventListener('click', () => {
      dismissReinstallPopup();
    });
  }

  const reinstallOverlay = document.getElementById('reinstall-overlay');
  if (reinstallOverlay) {
    reinstallOverlay.addEventListener('click', (e) => {
      if (e.target === reinstallOverlay) {
        dismissReinstallPopup();
      }
    });
  }

  async function checkAndShow() {
    try {
      const data = await _browser.storage.local.get([STORAGE_KEY, REINSTALL_WARNING_KEY, 'wmd_previous_version']);
      
      // 1. Check welcome onboarding
      if (!data[STORAGE_KEY]) {
        setTimeout(showWelcomePopup, 500);
      } else {
        // 2. If onboarding shown, check for reinstall warning
        try {
          const res = await fetch(_browser.runtime.getURL('changelog.json'));
          const changelog = await res.json();
          applyReinstallDescription(changelog);
          
          if (changelog.require_uninstall && data['wmd_previous_version'] && !data[REINSTALL_WARNING_KEY]) {
            setTimeout(showReinstallPopup, 500);
          }
        } catch (e) {
          console.error("Failed to read changelog.json:", e);
        }
      }
    } catch (e) {
      console.error("Error in checkAndShow:", e);
      _browser.storage.local.get(STORAGE_KEY, (data) => {
        if (!data[STORAGE_KEY]) {
          setTimeout(showWelcomePopup, 500);
        }
      });
    }
  }

  checkAndShow();
})();
