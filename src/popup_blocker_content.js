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

if (typeof browser === 'undefined') var browser = chrome;

let redirectGuardEnabled = false;
let redirectGuardClicks = 2;
let redirectGuardHideContent = false;
const blockedNavigationAttempts = new Map();
const SECOND_CLICK_WINDOW = 3500;

function setRedirectGuardEnabled(value) {
    redirectGuardEnabled = value === '1' || value === true;
    document.documentElement?.setAttribute('data-wmd-redirect-guard', redirectGuardEnabled ? '1' : '0');
}

browser.storage.local.get(['block-incoming-popups', 'redirect-guard-clicks', 'redirect-guard-hide-content']).then(stored => {
    setRedirectGuardEnabled(stored['block-incoming-popups']);
    redirectGuardClicks = Math.min(3, Math.max(1, Number(stored['redirect-guard-clicks']) || 2));
    redirectGuardHideContent = stored['redirect-guard-hide-content'] === '1' || stored['redirect-guard-hide-content'] === true;
}).catch(() => {});
browser.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes['block-incoming-popups']) {
        setRedirectGuardEnabled(changes['block-incoming-popups'].newValue);
    }
    if (area === 'local' && changes['redirect-guard-clicks']) {
        redirectGuardClicks = Math.min(3, Math.max(1, Number(changes['redirect-guard-clicks'].newValue) || 2));
    }
    if (area === 'local' && changes['redirect-guard-hide-content']) {
        const value = changes['redirect-guard-hide-content'].newValue;
        redirectGuardHideContent = value === '1' || value === true;
    }
});

function isCrossOriginHttpUrl(value) {
    try {
        const url = new URL(value, location.href);
        return /^https?:$/.test(url.protocol) && url.origin !== location.origin;
    } catch (_) {
        return false;
    }
}

function showRedirectBlockedNotice(remaining) {
    const old = document.getElementById('__wmd_redirect_guard_notice');
    if (old) old.remove();
    const notice = document.createElement('div');
    notice.id = '__wmd_redirect_guard_notice';
    notice.textContent = browser.i18n?.getMessage('redirectGuardBlockedNotice', String(remaining)) || `Redirect blocked. Tap ${remaining} more time(s) to continue.`;
    Object.assign(notice.style, {
        position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
        zIndex: '2147483647', padding: '10px 16px', borderRadius: '10px',
        background: 'rgba(25,25,25,.94)', color: '#fff', font: '14px sans-serif',
        boxShadow: '0 4px 18px rgba(0,0,0,.35)', pointerEvents: 'none'
    });
    (document.body || document.documentElement).appendChild(notice);
    setTimeout(() => notice.remove(), 2800);
}

function allowOrBlockNavigation(event, url) {
    if (!redirectGuardEnabled || !isCrossOriginHttpUrl(url)) return true;
    const key = new URL(url, location.href).href;
    const previous = blockedNavigationAttempts.get(key);
    const attempt = previous && Date.now() - previous.time <= SECOND_CLICK_WINDOW ? previous.count + 1 : 1;
    if (attempt >= redirectGuardClicks) {
        blockedNavigationAttempts.delete(key);
        document.documentElement?.setAttribute('data-wmd-navigation-allowed-until', String(Date.now() + 1000));
        browser.runtime.sendMessage({ action: 'popupBlockerGesture', url: key }).catch(() => {});
        return true;
    }
    blockedNavigationAttempts.clear();
    blockedNavigationAttempts.set(key, { count: attempt, time: Date.now() });
    event.preventDefault();
    event.stopImmediatePropagation();
    if (redirectGuardHideContent) {
        const blockedElement = event.target?.closest?.('a, form, [onclick]');
        if (blockedElement && blockedElement !== document.body && blockedElement !== document.documentElement) {
            blockedElement.style.setProperty('display', 'none', 'important');
            blockedElement.setAttribute('data-wmd-blocked-content', 'true');
        }
    }
    showRedirectBlockedNotice(redirectGuardClicks - attempt);
    browser.runtime.sendMessage({ action: 'redirectGuardBlocked', url: key }).catch(() => {});
    return false;
}

function scriptedRedirectUrl(element) {
    const clickable = element?.closest?.('[onclick],a[href^="javascript:"]');
    if (!clickable) return '';
    const script = `${clickable.getAttribute('onclick') || ''}\n${clickable.getAttribute('href') || ''}`;
    const match = script.match(/https?:\/\/[^'"\s)]+/i);
    return match ? match[0] : '';
}

function reportPopupIntent(event) {
    if (!event.isTrusted) return;
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) {
        const scriptedUrl = scriptedRedirectUrl(event.target);
        if (scriptedUrl) allowOrBlockNavigation(event, scriptedUrl);
        return;
    }
    if (/^javascript:/i.test(anchor.getAttribute('href') || '')) {
        const scriptedUrl = scriptedRedirectUrl(anchor);
        if (scriptedUrl) allowOrBlockNavigation(event, scriptedUrl);
        return;
    }
    if (!allowOrBlockNavigation(event, anchor.href)) return;
    const opensNewTab = anchor.target === '_blank' || event.button === 1 || event.ctrlKey || event.metaKey;
    if (!opensNewTab) return;
    let url = '';
    try { url = new URL(anchor.href, location.href).href; } catch (_) {}
    if (url) browser.runtime.sendMessage({ action: 'popupBlockerGesture', url }).catch(() => {});
}

document.addEventListener('click', reportPopupIntent, true);
document.addEventListener('auxclick', reportPopupIntent, true);
document.addEventListener('submit', event => {
    if (!event.isTrusted) return;
    const form = event.target;
    if (form?.action) allowOrBlockNavigation(event, form.action);
}, true);
