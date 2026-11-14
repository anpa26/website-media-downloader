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

    // Floating progress toast logic for background downloading
    const toastStyles = `
        .wmd-toast {
            position: fixed !important;
            bottom: 24px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 2147483647 !important;
            width: auto !important;
            min-width: 320px !important;
            max-width: 480px !important;
            background: rgba(25, 25, 25, 0.45) !important;
            backdrop-filter: blur(20px) !important;
            -webkit-backdrop-filter: blur(20px) !important;
            border: 1px solid rgba(255, 255, 255, 0.18) !important;
            border-radius: 9999px !important;
            box-shadow: 0 12px 40px rgba(0,0,0,0.4) !important;
            font-family: 'Segoe UI', Roboto, sans-serif !important;
            color: #fff !important;
            overflow: hidden !important;
            display: none !important;
            pointer-events: auto !important;
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            animation: wmd-toast-in 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            touch-action: pan-y !important;
            user-select: none !important;
            -webkit-user-select: none !important;
        }
        .wmd-toast.wmd-toast--show {
            display: flex !important;
            flex-direction: column !important;
        }
        .wmd-toast-inner {
            display: flex !important;
            align-items: center !important;
            padding: 14px 20px !important;
            gap: 14px !important;
        }
        .wmd-toast-thumb-placeholder {
            flex-shrink: 0 !important;
            color: var(--wmd-toast-theme, #8ab4f8) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
        .wmd-toast-content {
            flex-grow: 1 !important;
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 2px !important;
            margin-right: 4px !important;
        }
        .wmd-toast-title {
            font-size: 13px !important;
            font-weight: 600 !important;
            color: var(--wmd-toast-theme, #8ab4f8) !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            max-width: 300px !important;
        }
        .wmd-toast-status-row {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            font-size: 12px !important;
        }
        .wmd-toast-status {
            color: rgba(255,255,255,0.9) !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            max-width: 240px !important;
        }
        .wmd-toast-pct {
            color: rgba(255,255,255,0.5) !important;
            font-size: 11px !important;
        }
        .wmd-toast-close, .wmd-toast-min {
            background: none !important;
            border: none !important;
            color: rgba(255,255,255,0.4) !important;
            cursor: pointer !important;
            padding: 6px !important;
            border-radius: 50% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important;
        }
        .wmd-toast-close:hover, .wmd-toast-min:hover {
            color: #fff !important;
            background: rgba(255,255,255,0.1) !important;
        }
        .wmd-toast-progress-bar {
            position: absolute !important;
            bottom: 0 !important;
            left: 0 !important;
            height: 3px !important;
            background: var(--wmd-toast-theme, #8ab4f8) !important;
            width: 0% !important;
            transition: width 0.3s ease !important;
            opacity: 0.8 !important;
        }
        .wmd-toast--success .wmd-toast-progress-bar {
            background: #4CAF50 !important;
        }
        .wmd-toast--error .wmd-toast-progress-bar {
            background: #F44336 !important;
        }
        @keyframes wmd-toast-in {
            from { bottom: -80px; opacity: 0; transform: translateX(-50%) scale(0.9); }
            to { bottom: 24px; opacity: 1; transform: translateX(-50%) scale(1); }
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.textContent = toastStyles;
    (document.head || document.documentElement).appendChild(styleEl);

    let _toastEl = null;
    let _toastBarEl = null;
    let _toastStatusEl = null;
    let _toastPctEl = null;
    let _toastHideTimer = null;
    let _toastCurrentTaskId = null;
    let _activeCancellations = new Set();
    let _minimizedTasks = new Set();
    const _activeDownloads = new Map();

    function getToastThemeColor() {
        const color = String(cachedContentSettings['theme-color'] || '').trim();
        return /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(color)
            ? color
            : '#8ab4f8';
    }

    function getToastScale() {
        return cachedContentSettings['ui-scale'] || '85%';
    }

    function getToastZoomFactor() {
        const raw = String(getToastScale()).trim();
        const num = parseFloat(raw);
        if (!Number.isFinite(num) || num <= 0) return 0.85;
        return raw.endsWith('%') ? num / 100 : num;
    }

    function applyToastTheme() {
        if (_toastEl) {
            _toastEl.style.setProperty('--wmd-toast-theme', getToastThemeColor());
            _toastEl.style.zoom = getToastScale();
        }
    }

    function applyToastPosition(el, left, top) {
        const zoom = getToastZoomFactor();
        const vw = window.innerWidth / zoom;
        const vh = window.innerHeight / zoom;
        const w = el.offsetWidth || 320, h = el.offsetHeight || 60;
        left = Math.min(Math.max(0, left), Math.max(0, vw - w));
        top = Math.min(Math.max(0, top), Math.max(0, vh - h));
        el.dataset.customPos = '1';
        el.dataset.posLeft = String(left);
        el.dataset.posTop = String(top);
        el.style.setProperty('left', left + 'px', 'important');
        el.style.setProperty('top', top + 'px', 'important');
        el.style.setProperty('bottom', 'auto', 'important');
        el.style.setProperty('right', 'auto', 'important');
        el.style.setProperty('transform', 'none', 'important');
        el.style.setProperty('animation', 'none', 'important');
    }

    function getOrCreateToast() {
        if (_toastEl && document.body.contains(_toastEl)) {
            applyToastTheme();
            return _toastEl;
        }
        _toastEl = document.createElement('div');
        _toastEl.className = 'wmd-toast mdu-toast-surface';
        _toastEl.innerHTML = `
            <div class="wmd-toast-inner">
                <div class="wmd-toast-thumb-placeholder">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
                <div class="wmd-toast-content">
                    <div class="wmd-toast-title" id="wmd-title">Audio Only</div>
                    <div class="wmd-toast-status-row">
                        <span class="wmd-toast-status" id="wmd-status">Starting...</span>
                        <span class="wmd-toast-pct" id="wmd-pct">0%</span>
                    </div>
                </div>
                <button class="wmd-toast-min" id="wmd-min" title="Minimize (download continues)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <button class="wmd-toast-close" id="wmd-close" title="Cancel">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="wmd-toast-progress-bar" id="wmd-bar" style="width:0%"></div>
        `;
        applyToastTheme();
        document.body.appendChild(_toastEl);
        _toastBarEl = _toastEl.querySelector('#wmd-bar');
        _toastStatusEl = _toastEl.querySelector('#wmd-status');
        _toastPctEl = _toastEl.querySelector('#wmd-pct');
        _toastEl.querySelector('#wmd-min').addEventListener('click', () => {
            // Minimize: hide the toast but keep the download running in the background.
            // The download list (panel) still tracks it and offers Cancel/Pause there.
            if (_toastCurrentTaskId) {
                _minimizedTasks.add(_toastCurrentTaskId);
                try {
                    browser.storage.local.get('minimized-toast-tasks').then(r => {
                        const list = Array.isArray(r?.['minimized-toast-tasks']) ? r['minimized-toast-tasks'] : [];
                        if (!list.includes(_toastCurrentTaskId)) {
                            const updated = [...list.slice(-30), _toastCurrentTaskId];
                            browser.storage.local.set({ 'minimized-toast-tasks': updated }).catch(() => {});
                        }
                    }).catch(() => {});
                } catch (e) {}
            }
            hideToast(true);
        });
        _toastEl.querySelector('#wmd-close').addEventListener('click', () => {
            if (_toastCurrentTaskId) {
                if (_toastCurrentTaskId.startsWith('audio_') || _toastCurrentTaskId.startsWith('stream_') || _toastCurrentTaskId.startsWith('zip_') || _toastCurrentTaskId.startsWith('dl_')) {
                    browser.runtime.sendMessage({ action: 'cancelDownload', id: _toastCurrentTaskId }).catch(() => {});
                } else {
                    browser.runtime.sendMessage({ action: 'cancelDownload', url: _toastCurrentTaskId }).catch(() => {});
                }
                _activeCancellations.add(_toastCurrentTaskId);
                _minimizedTasks.delete(_toastCurrentTaskId);
                _activeDownloads.delete(_toastCurrentTaskId);
            }
            hideToast(true);
        });
        // WMD-es: make the toast draggable so the user can move the download bubble anywhere,
        // and remember where they leave it (persisted per browser via storage.local).
        (function enableDrag(el) {
            el.style.cursor = 'move';
            let dragging = false, moved = false, sx = 0, sy = 0, sLeft = 0, sTop = 0;
            try {
                browser.storage.local.get('toast-position').then(r => {
                    const p = r && r['toast-position'];
                    if (p && p.left != null && p.top != null && !dragging) applyToastPosition(el, p.left, p.top);
                }).catch(() => {});
            } catch (e) {}
            el.addEventListener('pointerdown', (e) => {
                if (e.target.closest('#wmd-min, #wmd-close')) return; // let the buttons work
                if (e.button) return; // left click only
                dragging = true; moved = false;
                const zoom = getToastZoomFactor();
                const r = el.getBoundingClientRect();
                sLeft = el.dataset.customPos === '1' ? parseFloat(el.dataset.posLeft) || (r.left / zoom) : (r.left / zoom);
                sTop = el.dataset.customPos === '1' ? parseFloat(el.dataset.posTop) || (r.top / zoom) : (r.top / zoom);
                sx = e.clientX; sy = e.clientY;
                el.style.setProperty('transition', 'none', 'important');
                try { el.setPointerCapture(e.pointerId); } catch (err) {}
                e.preventDefault();
            });
            el.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                const zoom = getToastZoomFactor();
                const dx = (e.clientX - sx) / zoom, dy = (e.clientY - sy) / zoom;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
                applyToastPosition(el, sLeft + dx, sTop + dy);
            });
            const end = (e) => {
                if (!dragging) return;
                dragging = false;
                el.style.removeProperty('transition');
                try { el.releasePointerCapture(e.pointerId); } catch (err) {}
                if (moved) {
                    const left = parseFloat(el.dataset.posLeft);
                    const top = parseFloat(el.dataset.posTop);
                    if (Number.isFinite(left) && Number.isFinite(top)) {
                        try { browser.storage.local.set({ 'toast-position': { left, top } }); } catch (err) {}
                    }
                }
            };
            el.addEventListener('pointerup', end);
            el.addEventListener('pointercancel', end);
            window.addEventListener('resize', () => {
                if (el.dataset.customPos === '1') {
                    const left = parseFloat(el.dataset.posLeft);
                    const top = parseFloat(el.dataset.posTop);
                    if (Number.isFinite(left) && Number.isFinite(top)) applyToastPosition(el, left, top);
                }
            });
        })(_toastEl);
        return _toastEl;
    }

    function showToast(taskId, filename, audioOnly = false) {
        if (_toastHideTimer) {
            clearTimeout(_toastHideTimer);
            _toastHideTimer = null;
        }
        _toastCurrentTaskId = taskId;
        _activeDownloads.set(taskId, {
            id: taskId,
            url: taskId,
            filename: filename || 'Downloading...',
            loaded: 0,
            total: 100,
            percent: 0,
            status: 'Starting...',
            isParallel: false,
            isPaused: false,
            mediaType: audioOnly ? 'audio' : 'video'
        });
        if (_minimizedTasks.has(taskId)) return;
        const toast = getOrCreateToast();
        toast.classList.remove('wmd-toast--success', 'wmd-toast--error');
        toast.classList.add('wmd-toast--show');
        toast.querySelector('#wmd-title').textContent = filename || (audioOnly ? 'Audio Only' : 'Downloading...');
        if (_toastBarEl) _toastBarEl.style.width = '0%';
        if (_toastPctEl) _toastPctEl.textContent = '0%';
        if (_toastStatusEl) _toastStatusEl.textContent = filename || 'Starting...';
    }

    function updateToastProgress(progress) {
        if (!_toastEl) return;
        const percent = Math.min(100, Math.round(progress));
        if (_toastBarEl) _toastBarEl.style.width = `${percent}%`;
        if (_toastPctEl) _toastPctEl.textContent = `${percent}%`;
        if (_toastCurrentTaskId) {
            const item = _activeDownloads.get(_toastCurrentTaskId);
            if (item) {
                item.percent = percent;
                item.loaded = percent;
            }
            browser.runtime.sendMessage({
                action: 'customStatus',
                id: _toastCurrentTaskId,
                percent: percent
            }).catch(() => {});
        }
    }

    function updateToastStatus(statusText) {
        statusText = String(statusText || '');
        const percentMatches = [...statusText.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*%/g)];
        if (percentMatches.length > 0) {
            const percent = Math.min(100, Math.round(Number(percentMatches[percentMatches.length - 1][1])));
            if (_toastBarEl) _toastBarEl.style.width = `${percent}%`;
            if (_toastPctEl) _toastPctEl.textContent = `${percent}%`;
            const item = _toastCurrentTaskId ? _activeDownloads.get(_toastCurrentTaskId) : null;
            if (item) {
                item.percent = percent;
                item.loaded = percent;
            }
        }
        statusText = statusText
            .replace(/\s*\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)/g, '')
            .replace(/\s*\d{1,3}(?:\.\d+)?\s*%/g, '')
            .replace(/:\s*$/, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        if (!statusText) statusText = 'Processing...';
        if (_toastStatusEl) _toastStatusEl.textContent = statusText;
        if (_toastCurrentTaskId) {
            const item = _activeDownloads.get(_toastCurrentTaskId);
            if (item) {
                item.status = statusText;
            }
            browser.runtime.sendMessage({
                action: 'customStatus',
                id: _toastCurrentTaskId,
                text: statusText
            }).catch(() => {});
        }
    }

    function finishToast(success, message) {
        if (!_toastEl) return;
        _toastEl.classList.remove('wmd-toast--success', 'wmd-toast--error');
        _toastEl.classList.add(success ? 'wmd-toast--success' : 'wmd-toast--error');
        if (_toastBarEl) _toastBarEl.style.width = success ? '100%' : _toastBarEl.style.width;
        if (_toastPctEl) _toastPctEl.textContent = success ? '100%' : _toastPctEl.textContent;
        if (_toastStatusEl) _toastStatusEl.textContent = message || (success ? 'Done!' : 'Failed');

        if (_toastCurrentTaskId) {
            _activeDownloads.delete(_toastCurrentTaskId);
            browser.runtime.sendMessage({
                action: 'customStatus',
                id: _toastCurrentTaskId,
                text: message || (success ? 'Done!' : 'Failed'),
                percent: success ? 100 : undefined
            }).catch(() => {});

            if (success) {
                browser.runtime.sendMessage({
                    action: 'downloadComplete',
                    id: _toastCurrentTaskId,
                    url: _toastCurrentTaskId
                }).catch(() => {});
            } else {
                browser.runtime.sendMessage({
                    action: 'downloadError',
                    id: _toastCurrentTaskId,
                    url: _toastCurrentTaskId,
                    error: message === 'Cancelled' ? 'USER_CANCELED' : message
                }).catch(() => {});
            }
        }

        _toastCurrentTaskId = null;
        _toastHideTimer = setTimeout(() => hideToast(false), 4000);
    }

    function hideToast(immediate) {
        if (!_toastEl) return;
        _toastEl.classList.remove('wmd-toast--show');
    }

    function applyAudioJobUpdate(message) {
        if (!processNotificationsEnabled()) {
            if (_toastCurrentTaskId === message.jobId) hideToast(true);
            return;
        }
        if (message.complete) {
            _minimizedTasks.delete(message.jobId);
            _activeDownloads.delete(message.jobId);
            if (!_toastEl || _toastCurrentTaskId !== message.jobId) return;
            _toastEl.classList.remove('wmd-toast--success', 'wmd-toast--error');
            _toastEl.classList.add(message.success ? 'wmd-toast--success' : 'wmd-toast--error');
            if (_toastStatusEl && message.text) _toastStatusEl.textContent = message.text;
            if (message.success && _toastBarEl) _toastBarEl.style.width = '100%';
            if (message.success && _toastPctEl) _toastPctEl.textContent = '100%';
            _toastHideTimer = setTimeout(() => hideToast(false), 4000);
            return;
        }
        if (_minimizedTasks.has(message.jobId)) {
            if (_toastCurrentTaskId === message.jobId) hideToast(true);
            return;
        }
        if (!_toastEl || _toastCurrentTaskId !== message.jobId) {
            showToast(message.jobId, message.filename || 'Audio Only', true);
        }
        if (!_toastEl) return;
        const title = _toastEl.querySelector('#wmd-title');
        if (title && message.filename) {
            title.textContent = message.total > 0
                ? `${message.filename} • ${(message.total / 1048576).toFixed(1)} MB`
                : message.filename;
        }
        let detail = message.text || '';
        if (/^Downloading/i.test(detail) && message.total > 0) detail += ` ${(message.loaded / 1048576).toFixed(1)} MB / ${(message.total / 1048576).toFixed(1)} MB`;
        else if (/^Downloading/i.test(detail) && message.loaded > 0) detail += ` ${(message.loaded / 1048576).toFixed(1)} MB`;
        if (detail && _toastStatusEl) _toastStatusEl.textContent = detail;
        if (message.percent !== undefined && message.percent !== null) {
            const percent = Math.min(100, Math.round(message.percent));
            if (_toastBarEl) _toastBarEl.style.width = `${percent}%`;
            if (_toastPctEl) _toastPctEl.textContent = `${percent}%`;
            const localItem = _activeDownloads.get(message.jobId);
            if (localItem) {
                localItem.percent = percent;
                localItem.loaded = message.loaded || 0;
                localItem.total = message.total || 0;
                localItem.status = message.text || localItem.status;
            }
        }
        if (message.indeterminate && _toastPctEl) _toastPctEl.textContent = '…';
    }
