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

(() => {
    const root = () => document.documentElement;
    const enabled = () => root()?.getAttribute('data-wmd-redirect-guard') !== '0';
    const REDIRECT_CHAIN_PREFIX = '__wmd_redirect_chain__:';
    const REDIRECT_CHAIN_TTL = 10000;
    let redirectChainUntil = 0;

    const restoreRedirectChainLater = (token, originalName, expires) => {
        setTimeout(() => {
            try {
                if (window.name === token && Date.now() >= expires) window.name = originalName;
            } catch (_) {}
        }, Math.max(0, expires - Date.now()) + 25);
    };

    const makeRedirectChainToken = (originalName = '') => {
        const expires = Date.now() + REDIRECT_CHAIN_TTL;
        return `${REDIRECT_CHAIN_PREFIX}${expires}|${encodeURIComponent(originalName)}`;
    };

    const readRedirectChain = () => {
        let value;
        try { value = String(window.name || ''); } catch (_) { return; }
        if (!value.startsWith(REDIRECT_CHAIN_PREFIX)) return;
        const separator = value.indexOf('|', REDIRECT_CHAIN_PREFIX.length);
        if (separator < 0) return;
        const expires = Number(value.slice(REDIRECT_CHAIN_PREFIX.length, separator));
        let originalName = '';
        try { originalName = decodeURIComponent(value.slice(separator + 1)); } catch (_) {}
        if (expires >= Date.now() && expires - Date.now() <= REDIRECT_CHAIN_TTL) {
            redirectChainUntil = expires;
            restoreRedirectChainLater(value, originalName, expires);
        } else {
            try { if (window.name === value) window.name = originalName; } catch (_) {}
        }
    };

    const allowRecentCrossOriginArrival = () => {
        if (!document.referrer) return;
        try {
            const referrer = new URL(document.referrer);
            if (/^https?:$/.test(referrer.protocol) && referrer.origin !== location.origin) {
                redirectChainUntil = Math.max(redirectChainUntil, Date.now() + REDIRECT_CHAIN_TTL);
            }
        } catch (_) {}
    };

    const armRedirectChain = () => {
        let originalName;
        try { originalName = String(window.name || ''); } catch (_) { return; }
        if (originalName.startsWith(REDIRECT_CHAIN_PREFIX)) {
            const separator = originalName.indexOf('|', REDIRECT_CHAIN_PREFIX.length);
            if (separator >= 0) {
                try { originalName = decodeURIComponent(originalName.slice(separator + 1)); } catch (_) {}
            }
        }
        redirectChainUntil = Date.now() + REDIRECT_CHAIN_TTL;
        let token;
        try {
            token = `${REDIRECT_CHAIN_PREFIX}${redirectChainUntil}|${encodeURIComponent(originalName)}`;
            window.name = token;
        } catch (_) { return; }
        restoreRedirectChainLater(token, originalName, redirectChainUntil);
    };

    readRedirectChain();
    allowRecentCrossOriginArrival();
    window.addEventListener('__wmdRedirectGuardArmChain', () => {
        if (enabled()) armRedirectChain();
    }, true);

    const consumeUrlPermission = (kind, destination) => {
        const untilAttribute = `data-wmd-${kind}-allowed-until`;
        const urlAttribute = `data-wmd-${kind}-allowed-url`;
        const until = Number(root()?.getAttribute(untilAttribute) || 0);
        const allowedUrl = root()?.getAttribute(urlAttribute) || '';
        let matches = false;
        try { matches = new URL(allowedUrl, location.href).href === new URL(destination, location.href).href; } catch (_) {}
        if (until >= Date.now()) {
            if (!matches) return false;
            root()?.removeAttribute(untilAttribute);
            root()?.removeAttribute(urlAttribute);
            return true;
        }
        root()?.removeAttribute(untilAttribute);
        root()?.removeAttribute(urlAttribute);
        return false;
    };
    const fakeLocation = new Proxy({ href: 'about:blank', assign() {}, replace() {}, reload() {} }, {
        set(target, property, value) { target[property] = value; return true; }
    });
    const makeFakeWindow = () => new Proxy({
        closed: false, opener: window, location: fakeLocation,
        focus() {}, blur() {}, close() { this.closed = true; }, postMessage() {}
    }, {
        get(target, property) { return property in target ? target[property] : undefined; },
        set(target, property, value) { target[property] = value; return true; }
    });

    const originalOpen = window.open;
    const nativeOpen = originalOpen.bind(window);
    let pageAssignedOpen = nativeOpen;
    const guardedOpen = function(...args) {
        if (!enabled()) return nativeOpen(...args);
        if (consumeUrlPermission('popup', args[0] || 'about:blank')) {
            const target = String(args[1] || '').toLowerCase();
            if (!target || target === '_blank') args[1] = makeRedirectChainToken();
            return nativeOpen(...args);
        }
        return makeFakeWindow();
    };

    try {
        const descriptor = Object.getOwnPropertyDescriptor(window, 'open');
        Object.defineProperty(window, 'open', {
            configurable: false,
            enumerable: descriptor?.enumerable ?? true,
            get() { return enabled() ? guardedOpen : pageAssignedOpen; },
            set(value) {
                if (typeof value === 'function' && value !== guardedOpen) {
                    pageAssignedOpen = value.bind(window);
                }
            }
        });
    } catch (_) {
        window.open = guardedOpen;
    }

    if (window.navigation?.addEventListener) {
        window.navigation.addEventListener('navigate', event => {
            if (!enabled() || !event.cancelable) return;
            let destination;
            try { destination = new URL(event.destination.url, location.href); } catch (_) { return; }
            if (!/^https?:$/.test(destination.protocol) || destination.origin === location.origin) return;
            if (consumeUrlPermission('navigation', destination.href)) return;
            if (!event.userInitiated && redirectChainUntil >= Date.now()) return;
            event.preventDefault();
            window.dispatchEvent(new CustomEvent('__wmdRedirectGuardBlocked', {
                detail: destination.href
            }));
        }, true);
    }
})();
