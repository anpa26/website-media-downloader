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



function syncNotificationSetting(isBgEnabled) {
    const notificationSwitch = document.getElementById('media-notification');
    if (!notificationSwitch) return;

    if (!isBgEnabled) {

        notificationSwitch.checked = false;
        notificationSwitch.disabled = true;
        browser.storage.local.set({ 'media-notification': '0' });
    } else {

        notificationSwitch.disabled = false;
    }
}

function applySettingsLayout(layoutType) {
    const container = document.getElementById('settings-container');
    if (!container) return;

    document.querySelectorAll('.settings-items-container').forEach(c => c.style.transition = 'none');

    container.classList.remove('layout-default', 'layout-clean', 'layout-sidebar', 'layout-tabs', 'clean-view-enabled');

    const oldSidebar = container.querySelector('.settings-sidebar-nav');
    if (oldSidebar) oldSidebar.remove();
    const oldTabsHeader = container.querySelector('.settings-tabs-header');
    if (oldTabsHeader) oldTabsHeader.remove();

    const groups = container.querySelectorAll('.settings-group');
    groups.forEach(group => {
        group.style.display = '';
        group.classList.remove('collapsed', 'active-sidebar-group', 'active-tab-group');
    });

    const icons = container.querySelectorAll('.collapse-icon');
    icons.forEach(icon => icon.style.display = 'none');

    if (layoutType === 'default') {
        container.classList.add('layout-default');
    }
    else if (layoutType === 'clean') {
        container.classList.add('layout-clean', 'clean-view-enabled');
        groups.forEach(group => group.classList.add('collapsed'));
        icons.forEach(icon => icon.style.display = 'block');
    }
    else if (layoutType === 'sidebar') {
        container.classList.add('layout-sidebar');

        const sidebarNav = document.createElement('div');
        sidebarNav.className = 'settings-sidebar-nav';

        groups.forEach((group, index) => {
            const titleSpan = group.querySelector('.settings-section-title span[data-translate]');
            const key = titleSpan ? titleSpan.getAttribute('data-translate') : null;
            const titleText = key ? (browser.i18n.getMessage(key) || titleSpan.textContent) : "Group";

            let svgIcon = '';
            const mduiIcon = group.querySelector('.settings-section-title mdui-icon');
            if (mduiIcon) svgIcon = mduiIcon.innerHTML;

            const navItem = document.createElement('div');
            navItem.className = 'sidebar-nav-item' + (index === 0 ? ' active' : '');
            navItem.innerHTML = `<span class="nav-icon">${svgIcon}</span>`;
            navItem.title = titleText;

            navItem.addEventListener('click', () => {
                sidebarNav.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
                navItem.classList.add('active');

                groups.forEach(g => g.classList.remove('active-sidebar-group'));
                group.classList.add('active-sidebar-group');
            });

            sidebarNav.appendChild(navItem);

            if (index === 0) {
                group.classList.add('active-sidebar-group');
            }
        });

        container.insertBefore(sidebarNav, container.firstChild);
    }
    else if (layoutType === 'tabs' || layoutType === 'tabs-icons') {
        container.classList.add('layout-tabs');

        const tabsHeader = document.createElement('div');
        tabsHeader.className = 'settings-tabs-header';
        if (layoutType === 'tabs-icons') {
            tabsHeader.classList.add('tabs-icons-only');
        }

        groups.forEach((group, index) => {
            const titleSpan = group.querySelector('.settings-section-title span[data-translate]');
            const key = titleSpan ? titleSpan.getAttribute('data-translate') : null;
            const titleText = key ? (browser.i18n.getMessage(key) || titleSpan.textContent) : "Group";

            const tabItem = document.createElement('div');
            tabItem.className = 'tabs-nav-item' + (index === 0 ? ' active' : '');

            if (layoutType === 'tabs') {
                tabItem.textContent = titleText;
            } else {
                let svgIcon = '';
                const mduiIcon = group.querySelector('.settings-section-title mdui-icon');
                if (mduiIcon) svgIcon = mduiIcon.innerHTML;
                tabItem.innerHTML = `<span class="nav-icon">${svgIcon}</span>`;
                tabItem.title = titleText;
            }

            tabItem.addEventListener('click', () => {
                tabsHeader.querySelectorAll('.tabs-nav-item').forEach(el => el.classList.remove('active'));
                tabItem.classList.add('active');

                groups.forEach(g => g.classList.remove('active-tab-group'));
                group.classList.add('active-tab-group');
            });

            tabsHeader.appendChild(tabItem);

            if (index === 0) {
                group.classList.add('active-tab-group');
            }
        });

        container.insertBefore(tabsHeader, container.firstChild);
    }

    document.body.offsetHeight;
    setTimeout(() => {
        document.querySelectorAll('.settings-items-container').forEach(c => c.style.transition = '');
    }, 50);

    setTimeout(enforceUIConstraints, 50);
}

function enforceUIConstraints() {
    const optimizeLowEnd = document.getElementById('optimize-low-end');
    if (optimizeLowEnd && optimizeLowEnd.checked) {
        const limitSelect = document.getElementById('limit-media-list');
        const limitCustom = document.getElementById('limit-media-list-custom');
        if (limitSelect) limitSelect.disabled = true;
        if (limitCustom) limitCustom.disabled = true;
    }
    const gdriveStream = document.getElementById('gdrive-stream');
    const dropboxStream = document.getElementById('dropbox-stream');
    const speedBoost = document.getElementById('speed-boost');
    if (((gdriveStream && gdriveStream.checked) || (dropboxStream && dropboxStream.checked)) && speedBoost) {
        speedBoost.disabled = true;
    }
}

function setupCollapsibleLogic() {
    const headers = document.querySelectorAll('.collapsible-header');

    headers.forEach(header => {
        if (header.dataset.collapsibleBound) return;
        header.dataset.collapsibleBound = "true";

        header.addEventListener('click', async () => {
            const layoutResult = await browser.storage.local.get('settings-layout');
            let layoutVal = layoutResult['settings-layout'] || 'tabs-icons';
            if (!layoutResult['settings-layout']) {
                const cleanViewResult = await browser.storage.local.get('clean-view');
                if (cleanViewResult['clean-view'] === '1') {
                    layoutVal = 'clean';
                }
            }
            if (layoutVal !== 'clean') return;

            const currentGroup = header.closest('.settings-group');
            if (!currentGroup) return;

            const isCurrentlyCollapsed = currentGroup.classList.contains('collapsed');

            document.querySelectorAll('.settings-group').forEach(group => {
                group.classList.add('collapsed');
            });

            if (isCurrentlyCollapsed) {
                currentGroup.classList.remove('collapsed');
                setTimeout(enforceUIConstraints, 50);
            }
        });
    });
}
