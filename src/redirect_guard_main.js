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
    const enabled = () => root()?.getAttribute('data-wmd-redirect-guard') === '1';
    const consumeExplicitNavigation = () => {
        const until = Number(root()?.getAttribute('data-wmd-navigation-allowed-until') || 0);
        if (until >= Date.now()) {
            root()?.removeAttribute('data-wmd-navigation-allowed-until');
            return true;
        }
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

    const nativeOpen = window.open.bind(window);
    window.open = function(...args) {
        if (!enabled() || consumeExplicitNavigation()) return nativeOpen(...args);
        return makeFakeWindow();
    };
})();
