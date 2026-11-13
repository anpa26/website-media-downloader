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



async function loadAboutPage() {
  const container = document.getElementById('about-container');
  try {
    const response = await fetch(browser.runtime.getURL('about.json?t=' + Date.now()));
    const data = await response.json();
    const manifest = browser.runtime.getManifest();
    const baseInstalledType = manifest.name.startsWith('Website Media Downloader Light')
      ? (browser.i18n.getMessage('installedTypeLight') || 'Light')
      : (browser.i18n.getMessage('installedTypeFull') || 'Full');
    const installedType = window.WMDDebugLogger ? `${baseInstalledType} (Debug)` : baseInstalledType;

    const isFirefox = navigator.userAgent.includes('Firefox') || (typeof browser !== 'undefined' && browser.runtime.getURL && browser.runtime.getURL('').startsWith('moz-extension://'));
    const reinstallUrl = isFirefox
      ? 'https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader/'
      : `https://github.com/anpa26/website-media-downloader/releases/tag/v${browser.runtime.getManifest().version}`;

    let requireUninstall = false;
    let hasDismissedWarning = false;
    let reinstallDescription = '';
    try {
      const [changelogRes, storageData] = await Promise.all([
        fetch(browser.runtime.getURL('changelog.json')),
        browser.storage.local.get('wmd_reinstall_about_dismissed')
      ]);
      const changelogData = await changelogRes.json();
      requireUninstall = !!changelogData.require_uninstall;
      const changelogLang = browser.i18n.getUILanguage().split('-')[0];
      const changelogContent = changelogData[changelogLang] || changelogData.en;
      reinstallDescription = changelogContent?.reinstall_description || '';
      hasDismissedWarning = storageData.wmd_reinstall_about_dismissed === '1';
    } catch (e) {
      console.warn("Failed to read settings in About:", e);
    }

    let reinstallCardHtml = '';
    if (requireUninstall && !hasDismissedWarning) {
      reinstallCardHtml = `
        <div style="display: flex; flex-direction: column; gap: 8px; padding: 18px 16px 12px; background: transparent; border-radius: var(--app-border-radius); border: 1px solid rgba(var(--mdui-color-error), 0.35); margin-top: 4px;">
          <div style="font-size: 0.85rem; font-weight: 700; color: rgb(var(--mdui-color-error)); display: flex; align-items: center; gap: 6px;">
            <mdui-icon style="font-size: 16px;"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></mdui-icon>
            ${browser.i18n.getMessage("reinstallTitle") || "Reinstallation Recommended"}
          </div>
          <p style="font-size: 0.78rem; line-height: 1.5; margin: 4px 0 8px; color: var(--on-surface-variant);">
            ${reinstallDescription}
          </p>
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <mdui-button id="about-confirm-reinstalled" style="--mdui-shape-corner-extra-small: 16px; height: 32px; font-size: 12px; background: rgba(var(--mdui-color-primary), 0.1); color: var(--primary);">
              ${browser.i18n.getMessage("confirmReinstalledBtn") || "Sudah Reinstall"}
            </mdui-button>
            <a href="${reinstallUrl}" target="_blank" style="text-decoration: none;">
              <mdui-button style="--mdui-shape-corner-extra-small: 16px; height: 32px; font-size: 12px; background: rgb(var(--mdui-color-error)); color: white;">
                <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></mdui-icon>
                ${browser.i18n.getMessage("reinstallActionBtn") || "Buka Toko"}
              </mdui-button>
            </a>
          </div>
        </div>
      `;
    }

    let updateCardHtml = '';
    if (window._wmd_latest_update && window._wmd_latest_update.updateAvailable) {
      const uInfo = window._wmd_latest_update;
      const isFx = false;
      const title = browser.i18n.getMessage("updateCardTitle") || "Update Available";
      const isSelfHosted = !!manifest.browser_specific_settings?.gecko?.update_url;
      const githubAhead = !isSelfHosted && !!uInfo.updateUrl && uInfo.updateUrl.includes('github.com')
        && !!uInfo.amoVersion && compareVersions(uInfo.latestVersion, uInfo.amoVersion) > 0;
      const desc = githubAhead
        ? (browser.i18n.getMessage("updateCardGithubAheadDesc", [uInfo.latestVersion, uInfo.amoVersion]) || (`Version ${uInfo.latestVersion} is available on GitHub, while AMO still has v${uInfo.amoVersion}. Download it now from GitHub, or wait for AMO. Once AMO is updated, it will install automatically if automatic updates are enabled. Installing from GitHub switches future updates to the GitHub release channel.`))
        : (isFx
          ? (browser.i18n.getMessage("updateCardFirefoxDesc", [uInfo.latestVersion]) || (`Version ${uInfo.latestVersion} has been detected. The extension will automatically update in the background within a maximum of 24 hours.`))
          : (browser.i18n.getMessage("updateCardChromeDesc", [uInfo.latestVersion]) || (`Version ${uInfo.latestVersion} has been detected. Click the button below to update to the latest version.`)));
      const btnText = githubAhead
        ? (browser.i18n.getMessage("updateCardGithubButton") || "Download on GitHub")
        : (browser.i18n.getMessage("updateCardButton") || "Update Now");
      const actionHtml = githubAhead ? `<div style="display: flex; justify-content: flex-end; margin-top: 8px;"><a href="${uInfo.updateUrl || "https://github.com/anpa26/website-media-downloader/releases"}" target="_blank" style="text-decoration: none;"><mdui-button style="--mdui-shape-corner-extra-small: 16px; height: 32px; font-size: 12px; background: var(--primary); color: var(--surface-low);"><mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></mdui-icon>${btnText}</mdui-button></a></div>` : (isFx ? "" : `<div style="display: flex; justify-content: flex-end; margin-top: 8px;"><a href="${uInfo.updateUrl || "https://github.com/anpa26/website-media-downloader/releases"}" target="_blank" style="text-decoration: none;"><mdui-button style="--mdui-shape-corner-extra-small: 16px; height: 32px; font-size: 12px; background: var(--primary); color: var(--surface-low);"><mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></mdui-icon>${btnText}</mdui-button></a></div>`);

      updateCardHtml = `
        <div id="about-update-card" style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; background: transparent; border-radius: var(--app-border-radius); border: 1px solid rgba(var(--mdui-color-primary), 0.35);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 6px;">
              <mdui-icon style="font-size: 18px;"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></mdui-icon>
              ${title} (v${uInfo.latestVersion})
            </div>
            <mdui-button-icon id="update-card-help-btn" style="width: 28px; height: 28px; min-width: 28px; color: var(--primary);" title="Changelog & Details">
              <mdui-icon style="font-size: 20px;">
                <svg viewBox="0 -960 960 960"><path fill="currentColor" d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80q0-32 6.5-52.5T560-542q30-26 45-50.5t15-57.5q0-58-41-94t-101-36q-59 0-98.5 34.5T329-647l68 31q13-31 36.5-47.5T481-680q26 0 42.5 15.5T540-628q0 20-11.5 37.5T500-562q-40 33-50 56.5t-10 65.5Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>
              </mdui-icon>
            </mdui-button-icon>
          </div>
          <p style="font-size: 0.78rem; line-height: 1.5; margin: 2px 0 0; color: var(--on-surface-variant);">
            ${desc}
          </p>
          ${actionHtml}
        </div>
      `;
    }

    let html = `
      <div class="about-content" style="padding: 16px; display: flex; flex-direction: column; gap: 24px;">
        <div style="text-align: center; padding: 24px 16px; background: var(--surface-low); border-radius: var(--app-border-radius); border: 1px solid rgb(var(--mdui-color-outline-variant));">
          <div style="width: 72px; height: 72px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
            <img src="${browser.runtime.getURL('icons/icon.png')}" style="width: 72px; height: 72px; object-fit: contain;">
          </div>
          <h1 style="margin: 0; font-size: 1.4rem; font-weight: 700; color: rgb(var(--mdui-color-on-surface));">${data.extension.name}</h1>
          <p style="font-size: 0.9rem; line-height: 1.6; margin: 16px 0 0; color: var(--on-surface-variant);">${browser.i18n.getMessage("extensionDescriptionAbout") || data.extension.description}</p>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: var(--surface-low); border-radius: var(--app-border-radius); border: 1px solid rgb(var(--mdui-color-outline-variant));">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--on-surface-variant); padding-left: 4px; display: flex; flex-direction: column; gap: 3px;">
              <span>${browser.i18n.getMessage("installedVersion") || "Version"} ${data.extension?.version || manifest.version}</span>
              <span style="font-size: 0.75rem; font-weight: 500; opacity: 0.8;">${browser.i18n.getMessage('installedType') || 'Installed Type'}: ${installedType}</span>
            </div>
            <mdui-button id="manual-check-update" style="--mdui-shape-corner-extra-small: 16px; height: 32px; font-size: 12px; background: linear-gradient(135deg, rgba(var(--mdui-color-primary), 0.15), rgba(var(--mdui-color-on-surface), 0.08)); backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%); box-shadow: inset 2px 2px 4px rgba(0, 0, 0, 0.1), inset -2px -2px 4px rgba(255, 255, 255, 0.05); border: 1px solid rgba(var(--mdui-color-primary), 0.15); color: var(--primary);">
              <mdui-icon slot="icon"><svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></mdui-icon>
              ${browser.i18n.getMessage("checkUpdateButton") || "Check for Updates"}
            </mdui-button>
          </div>
          <div id="update-status-text" style="font-size: 0.75rem; font-weight: 500; text-align: center; display: none; color: var(--on-surface-variant); border-top: 1px solid rgba(var(--mdui-color-outline-variant), 0.5); margin-top: 4px; padding-top: 8px;"></div>
        </div>
        ${reinstallCardHtml}
        ${updateCardHtml}


      `;

    html += `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <h2 style="font-size: 0.9rem; font-weight: 700; text-transform: none; letter-spacing: 0.02em; color: var(--primary); margin: 0 8px;">${browser.i18n.getMessage("maintainedByTitle") || "Maintained By"}</h2>
    `;

    const lead = data.authors[0];
    html += `
        <mdui-card variant="outlined" style="padding: 20px !important; background: transparent; box-shadow: none; border: 1px solid rgb(var(--mdui-color-outline-variant)); overflow: visible; border-radius: var(--app-border-radius);">
          <div style="display: flex; gap: 16px; align-items: center; position: relative;">
            <mdui-avatar src="${lead.avatar}" style="width: 56px; height: 56px; border: 2px solid rgba(255,255,255,0.1); box-shadow: 0 4px 12px rgba(0,0,0,0.15);"></mdui-avatar>
            <div style="flex-grow: 1;">
              <b style="font-size: 1.1rem; color: var(--primary);">${lead.name}</b>
              <p style="margin: 8px 0 0; font-size: 0.85rem; line-height: 1.5; color: var(--on-surface-variant);">${browser.i18n.getMessage("leadDeveloperDescription") || lead.description}</p>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; align-self: stretch; justify-content: center; min-width: 80px;">
              <mdui-button-icon variant="filled" style="--mdui-color-primary: var(--primary); --mdui-color-on-primary: var(--surface-low); flex-shrink: 0;" href="${lead.github}" target="_blank">
                <svg viewBox="0 0 24 24" style="fill: currentColor;"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
              </mdui-button-icon>
            </div>
          </div>
        </mdui-card>
    `;

    if (data.authors.length > 1) {
      html += `
        <h2 style="font-size: 0.75rem; font-weight: 700; text-transform: none; letter-spacing: 0.02em; color: var(--on-surface-variant); margin: 12px 8px 0;">${browser.i18n.getMessage("legacyContributionsTitle") || "Legacy Contributions"}</h2>
        <mdui-list style="background: transparent;">
      `;

      data.authors.slice(1).forEach((author) => {
        html += `
          <mdui-list-item nonclickable style="border-radius: 12px; margin-bottom: 4px;">
            <mdui-avatar slot="icon" src="${author.avatar}" style="width: 32px; height: 32px;"></mdui-avatar>
            <div style="font-weight: 600; font-size: 0.9rem;">${author.name}</div>
            <div slot="description" style="font-size: 0.8rem; opacity: 0.7;">${browser.i18n.getMessage("legacyContributorDescription") || author.description}</div>
            <mdui-button-icon slot="end-icon" href="${author.github}" target="_blank">
              <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            </mdui-button-icon>
          </mdui-list-item>
        `;
      });

      html += `</mdui-list>`;
    }

    html += `
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <h2 style="font-size: 0.75rem; font-weight: 700; text-transform: none; letter-spacing: 0.02em; color: var(--primary); margin: 8px 8px 0;">${browser.i18n.getMessage("usefulLinksTitle") || "Useful Links"}</h2>
    `;

    const linkTranslationMap = {
      "Official Website": "officialWebsite",
      "Star on GitHub": "starOnGithub",
      "Rate on Add-ons": "rateOnAddons",
      "GitHub Repository": "githubRepositoryLabel",
      "Report Issue": "reportIssue"
    };

    const officialLink = data.links.find(l => l.label === "Official Website");
    const otherLinks = data.links.filter(l => l.label !== "Official Website");

    if (officialLink) {
      const transKey = linkTranslationMap[officialLink.label];
      const localizedLabel = transKey ? (browser.i18n.getMessage(transKey) || officialLink.label) : officialLink.label;
      html += `
        <mdui-card variant="outlined" href="${officialLink.url}" target="_blank" clickable style="background: transparent; box-shadow: none; border: 1px solid rgb(var(--mdui-color-outline-variant)); border-radius: var(--app-border-radius); transition: var(--transition); width: 100%; box-sizing: border-box;">
          <div style="padding: 14px 16px; display: flex; align-items: center; gap: 14px; box-sizing: border-box; width: 100%;">
            <div style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: rgba(var(--mdui-color-primary), 0.15); color: var(--primary); border-radius: 10px; flex-shrink: 0;">
              <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;"><path d="${officialLink.icon}"/></svg>
            </div>
            <div style="flex-grow: 1;">
              <div style="font-size: 0.85rem; font-weight: 700; color: rgb(var(--mdui-color-on-surface));">${localizedLabel}</div>
              <div style="font-size: 0.72rem; color: var(--on-surface-variant); opacity: 0.7; margin-top: 2px;">wmd.devianproject.tech</div>
            </div>
          </div>
        </mdui-card>
      `;
    }

    html += `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
    `;

    otherLinks.forEach((link) => {
      const transKey = linkTranslationMap[link.label];
      const localizedLabel = transKey ? (browser.i18n.getMessage(transKey) || link.label) : link.label;
      html += `
        <mdui-card variant="outlined" href="${link.url}" target="_blank" clickable style="background: transparent; box-shadow: none; border: 1px solid rgb(var(--mdui-color-outline-variant)); border-radius: var(--app-border-radius); transition: var(--transition); height: 100%;">
          <div style="padding: 12px; display: flex; align-items: center; gap: 12px; height: 100%; box-sizing: border-box;">
            <div style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: rgba(var(--mdui-color-primary), 0.1); color: var(--primary); border-radius: 10px; flex-shrink: 0;">
              <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;"><path d="${link.icon}"/></svg>
            </div>
            <span style="font-size: 0.85rem; font-weight: 600; line-height: 1.2; color: rgb(var(--mdui-color-on-surface));">${localizedLabel}</span>
          </div>
        </mdui-card>
      `;
    });

    html += `
          </div>
        </div>

        <div style="text-align: center; margin-top: 12px; opacity: 0.5; font-size: 0.7rem;">
          ${browser.i18n.getMessage("releasedUnderLicense", [data.extension.license]) || `Released under ${data.extension.license} License`}
        </div>
      </div>
    `;

    container.innerHTML = html;

    const updateCardHelpBtn = document.getElementById('update-card-help-btn');
    if (updateCardHelpBtn) {
      updateCardHelpBtn.addEventListener('click', () => {
        const helpBtn = document.getElementById('help-button');
        if (helpBtn) {
          helpBtn.click();
        }
      });
    }

    const confirmReinstallBtn = document.getElementById('about-confirm-reinstalled');
    if (confirmReinstallBtn) {
      confirmReinstallBtn.addEventListener('click', async () => {
        try {
          await browser.storage.local.set({ 'wmd_reinstall_about_dismissed': '1' });
          loadAboutPage();
        } catch (e) {
          console.error("Failed to dismiss reinstall card:", e);
        }
      });
    }

    const checkBtn = document.getElementById('manual-check-update');
    const statusText = document.getElementById('update-status-text');
    let statusTimeout = null;

    if (checkBtn) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.loading = true;
        checkBtn.disabled = true;

        if (statusTimeout) clearTimeout(statusTimeout);
        if (statusText) {
          statusText.style.display = 'none';
          statusText.textContent = '';
        }

        let nativeUpdateFound = false;
        if (browser.runtime.requestUpdateCheck) {
          try {
            const result = await browser.runtime.requestUpdateCheck();
            if (result && result.status === 'update_available') {
              window._wmd_latest_update = {
                updateAvailable: true,
                latestVersion: result.version || 'new',
                updateUrl: 'https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader'
              };
              nativeUpdateFound = true;
            }
          } catch (err) {
            console.warn('Native update check failed, trying GitHub fallback:', err);
          }
        }

        if (nativeUpdateFound) {
          checkBtn.loading = false;
          checkBtn.disabled = false;
          loadAboutPage();
          return;
        }

        try {
          const result = await performUpdateCheck();
          if (result.updateAvailable) {
            window._wmd_latest_update = {
              updateAvailable: true,
              latestVersion: result.latestVersion,
              updateUrl: result.updateUrl,
              amoVersion: result.amoVersion || null,
            };
            loadAboutPage();
          } else {
            if (statusText) {
              statusText.textContent = browser.i18n.getMessage("alreadyLatestVersion") || "You are using the latest version.";
              statusText.style.display = 'block';
              statusText.style.color = 'var(--on-surface-variant)';
              statusTimeout = setTimeout(() => {
                statusText.style.display = 'none';
              }, 3000);
            }
          }
        } catch (error) {
          console.error('Manual check failed:', error);
          if (statusText) {
            statusText.textContent = browser.i18n.getMessage("updateCheckError") || "Failed to check for updates.";
            statusText.style.display = 'block';
            statusText.style.color = 'rgb(var(--mdui-color-error))';
            statusTimeout = setTimeout(() => {
              statusText.style.display = 'none';
            }, 3000);
          }
        } finally {
          checkBtn.loading = false;
          checkBtn.disabled = false;
        }
      });
    }
  } catch (error) {
    console.error("Failed to load about page:", error);
    container.innerHTML = `<div style="padding: 40px; text-align: center;">${browser.i18n.getMessage("failedToLoadAbout") || "Failed to load About page information."}</div>`;
  }
}
