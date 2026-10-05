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

const popupBlockerGestures = new Map();
const popupBlockerPendingTabs = new Map();
const POPUP_GESTURE_TTL = 2500;

async function popupBlockerEnabled() {
    const stored = await browser.storage.local.get('block-incoming-popups').catch(() => ({}));
    const value = stored['block-incoming-popups'];
    return value === '1' || value === true;
}

function popupBlockerIsTrustedInternalUrl(url) {
    return /^(?:moz|chrome)-extension:|^(?:about|chrome|chrome-search|edge|brave|vivaldi|opera|resource):/i.test(url || '');
}

function popupBlockerSameDestination(intendedUrl, targetUrl) {
    try {
        const intended = new URL(intendedUrl);
        const target = new URL(targetUrl);
        return intended.origin === target.origin;
    } catch (_) {
        return false;
    }
}

async function inspectIncomingPopup(tabId, openerTabId, targetUrl) {
    if (!await popupBlockerEnabled()) return;
    const opener = await browser.tabs.get(openerTabId).catch(() => null);
    if (!opener || popupBlockerIsTrustedInternalUrl(opener.url) || popupBlockerIsTrustedInternalUrl(targetUrl)) return;

    const gesture = popupBlockerGestures.get(openerTabId);
    const fresh = gesture && Date.now() - gesture.time <= POPUP_GESTURE_TTL;
    if (fresh && popupBlockerSameDestination(gesture.url, targetUrl)) {
        popupBlockerGestures.delete(openerTabId);
        return;
    }
    if (!fresh) popupBlockerGestures.delete(openerTabId);

    await browser.tabs.remove(tabId).catch(() => {});
}

browser.runtime.onMessage.addListener((message, sender) => {
    if (message.action !== 'popupBlockerGesture' || sender.tab?.id === undefined) return;
    popupBlockerGestures.set(sender.tab.id, { url: message.url || '', time: Date.now() });
});

browser.tabs.onCreated.addListener(tab => {
    if (tab.openerTabId === undefined || popupBlockerIsTrustedInternalUrl(tab.url)) return;
    if (tab.url && tab.url !== 'about:blank') {
        inspectIncomingPopup(tab.id, tab.openerTabId, tab.url);
        return;
    }
    popupBlockerPendingTabs.set(tab.id, tab.openerTabId);
    setTimeout(() => popupBlockerPendingTabs.delete(tab.id), 10000);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const openerTabId = popupBlockerPendingTabs.get(tabId);
    if (openerTabId === undefined || !changeInfo.url || changeInfo.url === 'about:blank') return;
    popupBlockerPendingTabs.delete(tabId);
    inspectIncomingPopup(tabId, openerTabId, changeInfo.url);
});

browser.tabs.onRemoved.addListener(tabId => {
    popupBlockerPendingTabs.delete(tabId);
    popupBlockerGestures.delete(tabId);
});
