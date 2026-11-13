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

function showSimpleToast(tabId, message) {
    if (!browser.scripting) return;
    browser.scripting.executeScript({
        target: { tabId: tabId },
        func: (msg) => {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
                background: #4caf50; color: white; padding: 12px 24px; border-radius: 8px;
                z-index: 2147483647; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-family: system-ui, sans-serif; font-size: 14px; font-weight: 500;
                animation: mdu-slide-down 0.4s cubic-bezier(0, 0, 0.2, 1);
            `;
            toast.textContent = msg;

            const style = document.createElement('style');
            style.textContent = `@keyframes mdu-slide-down { from { top: -60px; opacity: 0; } to { top: 24px; opacity: 1; } }`;
            document.head.appendChild(style);
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; setTimeout(() => toast.remove(), 500); }, 3000);
        },
        args: [message]
    }).catch(() => {});
}
