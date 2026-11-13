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






async function checkAndShowEventPopup() {
  try {
    const welcomeData = await browser.storage.local.get(['wmd_reinstall_warning_shown', 'wmd_previous_version']);

    let requireUninstall = false;
    try {
      const res = await fetch(browser.runtime.getURL('changelog.json'));
      const changelog = await res.json();
      if (changelog.require_uninstall && welcomeData['wmd_previous_version'] && !welcomeData['wmd_reinstall_warning_shown']) {
        requireUninstall = true;
      }
    } catch (e) {}

    if (requireUninstall) return;

    const rawUrl = 'https://raw.githubusercontent.com/anpa26/website-media-downloader/wmd-1-event';
    const response = await fetch(`${rawUrl}/info.json?t=` + Date.now());
    if (!response.ok) return;

    const info = await response.json();
    if (!info || info.enabled === false || !info.storage_key) return;

    if (info.version !== undefined && info.version !== null && info.version !== '') {
      const currentVersion = String(browser.runtime.getManifest().version).trim();
      const allowedVersions = (Array.isArray(info.version) ? info.version : [info.version])
        .map(v => String(v).trim().replace(/^v/i, ''));
      if (!allowedVersions.includes(currentVersion)) return;
    }

    const storageResult = await browser.storage.local.get(info.storage_key);
    if (storageResult[info.storage_key]) return;

    const dialog = document.createElement('mdui-dialog');
    dialog.closeOnOverlayClick = !info.show_skip ? false : true;
    dialog.closeOnEsc = !info.show_skip ? false : true;

    if (info.title) {
      const headline = document.createElement('div');
      headline.setAttribute('slot', 'headline');
      headline.style.width = '100%';
      headline.style.fontWeight = 'bold';
      headline.textContent = info.title;
      const titlePos = (info.title_position || 'left').toLowerCase();
      headline.style.textAlign = titlePos === 'center' ? 'center' : titlePos === 'right' ? 'right' : 'left';
      dialog.appendChild(headline);
    }

    const contentDiv = document.createElement('div');
    contentDiv.setAttribute('slot', 'description');
    contentDiv.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

    const renderEventDetails = (target, item) => {
      const whatsNewList = item.whats_new || item.whatsNew || item.points || item.changelog;
      if (Array.isArray(whatsNewList) && whatsNewList.length > 0) {
        const wnContainer = document.createElement('div');
        wnContainer.style.cssText = 'display: flex; flex-direction: column; gap: 6px; margin-top: 4px;';

        const wnTitle = document.createElement('div');
        wnTitle.style.cssText = 'font-weight: 700; font-size: 0.9rem; text-align: left; color: var(--primary);';
        wnTitle.textContent = item.whats_new_title || item.whatsNewTitle || "What's New:";
        wnContainer.appendChild(wnTitle);

        const ul = document.createElement('ul');
        ul.style.cssText = 'margin: 0; padding-left: 20px; text-align: left; line-height: 1.5; font-size: 0.85rem;';
        whatsNewList.forEach(pt => {
          const li = document.createElement('li');
          li.style.marginBottom = '4px';
          li.textContent = pt;
          ul.appendChild(li);
        });
        wnContainer.appendChild(ul);
        target.appendChild(wnContainer);
      }
    };

    let slides = [];
    if (info.slides && Array.isArray(info.slides)) slides = info.slides;
    else if (info.images && Array.isArray(info.images) && info.images.length > 0) slides = info.images.map(img => ({ image: img }));
    else if (info.image) slides = [{ image: info.image }];
    else slides = [{}];

    const hasSharedDetails = !!(info.whats_new || info.whatsNew || info.points || info.changelog);

    let descEl = null;
    if (slides.length === 1) {
      const slide = slides[0];
      if (slide.image) {
        const img = document.createElement('img');
        img.src = `${rawUrl}/${slide.image}`;
        img.style.cssText = 'width: 100%; border-radius: 8px; max-height: 360px; object-fit: contain; background: rgba(0, 0, 0, 0.05);';
        contentDiv.appendChild(img);
      }
      const detailsDiv = document.createElement('div');
      renderEventDetails(detailsDiv, hasSharedDetails ? info : slide);
      contentDiv.appendChild(detailsDiv);
    } else if (slides.length > 1) {
      const hasAnyImage = slides.some(s => !!s.image);
      let track = null, currentIndex = 0;
      const totalSlides = slides.length;
      const dotsContainer = document.createElement('div');
      dotsContainer.style.cssText = 'display: flex; justify-content: center; gap: 6px;';
      slides.forEach((_, idx) => {
        const dot = document.createElement('div');
        dot.className = 'carousel-dot';
        dot.style.cssText = 'width: 6px; height: 6px; border-radius: 50%; cursor: pointer; transition: all 0.2s;';
        dot.addEventListener('click', () => { currentIndex = idx; updateCarousel(); });
        dotsContainer.appendChild(dot);
      });
      const prevBtn = document.createElement('button');
      prevBtn.innerHTML = '&#10094;';
      const nextBtn = document.createElement('button');
      nextBtn.innerHTML = '&#10095;';
      const setArrowStyleCarousel = (btn, isRight) => {
        btn.style.cssText = `position: absolute; ${isRight ? 'right' : 'left'}: 8px; z-index: 10; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; font-weight: bold; transition: background 0.2s;`;
        btn.onmouseover = () => btn.style.background = 'rgba(0,0,0,0.8)';
        btn.onmouseout = () => btn.style.background = 'rgba(0,0,0,0.5)';
      };
      const setArrowStyleText = (btn) => {
        btn.style.cssText = 'background: none; color: rgb(var(--mdui-color-primary)); border: none; cursor: pointer; font-size: 16px; font-weight: bold; padding: 4px 12px; display: flex; align-items: center; justify-content: center; position: static; width: auto; height: auto;';
        btn.onmouseover = null; btn.onmouseout = null;
      };
      let carouselContainer = null;
      if (hasAnyImage) {
        carouselContainer = document.createElement('div');
        carouselContainer.style.cssText = 'position: relative; width: 100%; overflow: hidden; border-radius: 8px; display: flex; align-items: center; margin-bottom: 8px;';
        track = document.createElement('div');
        track.style.cssText = 'display: flex; width: 100%; transition: transform 0.3s ease;';
        slides.forEach(slide => {
          const sc = document.createElement('div');
          sc.style.cssText = 'width: 100%; flex-shrink: 0; max-height: 360px; min-height: 180px; display: flex; align-items: center; justify-content: center; border-radius: 8px; overflow: hidden; background: rgba(0, 0, 0, 0.05);';
          if (slide.image) {
            const img = document.createElement('img');
            img.src = `${rawUrl}/${slide.image}`;
            img.style.cssText = 'width: 100%; height: auto; max-height: 360px; object-fit: contain;';
            sc.appendChild(img);
          }
          track.appendChild(sc);
        });
        carouselContainer.appendChild(track);
        contentDiv.appendChild(carouselContainer);
      }
      descEl = document.createElement('p');
      descEl.style.cssText = 'margin: 0; line-height: 1.4; min-height: 48px;';
      contentDiv.appendChild(descEl);
      const navRow = document.createElement('div');
      navRow.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 8px; margin-bottom: 4px; width: 100%;';
      contentDiv.appendChild(navRow);
      const updateCarousel = () => {
        const cs = slides[currentIndex];
        if (cs && cs.image && carouselContainer) {
          carouselContainer.style.display = 'flex'; navRow.style.display = 'none';
          setArrowStyleCarousel(prevBtn, false); setArrowStyleCarousel(nextBtn, true);
          carouselContainer.appendChild(prevBtn); carouselContainer.appendChild(nextBtn);
          dotsContainer.style.cssText = 'display: flex; justify-content: center; gap: 6px; margin-top: -4px; margin-bottom: 4px;';
          contentDiv.insertBefore(dotsContainer, descEl);
          if (track) track.style.transform = `translateX(-${currentIndex * 100}%)`;
        } else {
          if (carouselContainer) carouselContainer.style.display = 'none';
          navRow.style.display = 'flex';
          setArrowStyleText(prevBtn); setArrowStyleText(nextBtn);
          navRow.appendChild(prevBtn); navRow.appendChild(dotsContainer); navRow.appendChild(nextBtn);
          dotsContainer.style.cssText = 'display: flex; justify-content: center; gap: 6px;';
        }
        dotsContainer.querySelectorAll('.carousel-dot').forEach((dot, idx) => {
          dot.style.background = idx === currentIndex ? 'rgb(var(--mdui-color-primary))' : 'rgba(var(--mdui-color-on-surface), 0.3)';
          dot.style.transform = idx === currentIndex ? 'scale(1.2)' : 'scale(1)';
        });
        descEl.innerHTML = '';
        const activeDetails = hasSharedDetails ? info : cs;
        if (activeDetails && (activeDetails.whats_new || activeDetails.whatsNew || activeDetails.points || activeDetails.changelog)) {
          renderEventDetails(descEl, activeDetails);
          descEl.style.display = 'block';
        } else {
          descEl.style.display = 'none';
        }
      };
      prevBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); currentIndex = (currentIndex - 1 + totalSlides) % totalSlides; updateCarousel(); });
      nextBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); currentIndex = (currentIndex + 1) % totalSlides; updateCarousel(); });
      updateCarousel();
    }

    dialog.appendChild(contentDiv);
    const actionWrapper = document.createElement('div');
    actionWrapper.setAttribute('slot', 'action');
    actionWrapper.style.cssText = 'display: flex; width: 100%; gap: 8px;';
    const pos = (info.button_position || 'right').toLowerCase();
    const actionBtn = document.createElement('mdui-button');
    actionBtn.variant = 'filled';
    actionBtn.textContent = info.button_text || 'OK';
    actionBtn.addEventListener('click', async () => {
      await browser.storage.local.set({ [info.storage_key]: true });
      dialog.open = false;
      if (info.action_url) window.open(info.action_url, '_blank');
    });
    let skipBtn = null;
    if (info.show_skip) {
      skipBtn = document.createElement('mdui-button');
      skipBtn.variant = 'text';
      skipBtn.textContent = browser.i18n.getMessage("cancelButton") || 'Skip';
      skipBtn.addEventListener('click', async () => { await browser.storage.local.set({ [info.storage_key]: true }); dialog.open = false; });
    }
    if (pos === 'center') {
      actionWrapper.style.flexDirection = 'column'; actionWrapper.style.justifyContent = 'center'; actionWrapper.style.alignItems = 'center';
    } else {
      actionWrapper.style.flexDirection = 'row'; actionWrapper.style.alignItems = 'center';
      actionWrapper.style.justifyContent = pos === 'left' ? 'flex-start' : 'flex-end';
    }
    actionWrapper.appendChild(actionBtn);
    if (skipBtn) actionWrapper.appendChild(skipBtn);
    dialog.appendChild(actionWrapper);
    document.body.appendChild(dialog);
    dialog.open = true;
    dialog.addEventListener('closed', () => { dialog.remove(); });
  } catch (error) {
    console.error('Error fetching/displaying event popup:', error);
  }
}
