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

(function initWmdDebugLogger(globalScope) {
    if (globalScope.__WMD_DEBUG_LOGGER_INITIALIZED__) return;
    globalScope.__WMD_DEBUG_LOGGER_INITIALIZED__ = true;

    const extBrowser = typeof globalScope.browser !== 'undefined'
        ? globalScope.browser
        : (typeof globalScope.chrome !== 'undefined' ? globalScope.chrome : null);

    const STORAGE_KEY = 'wmd_debug_logs';
    const MAX_MEMORY_ENTRIES = 1200;
    const MAX_STORAGE_ENTRIES = 2000;
    const FLUSH_DEBOUNCE_MS = 800;

    const startWallTime = Date.now();
    const startPerfNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : 0;

    function getPerfDeltaMs() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return Number((performance.now() - startPerfNow).toFixed(2));
        }
        return Date.now() - startWallTime;
    }

    function detectContextName() {
        try {
            if (typeof window === 'undefined' || typeof document === 'undefined') {
                return 'BACKGROUND_SW';
            }
            const path = (window.location && window.location.pathname) ? window.location.pathname : '';
            const search = (window.location && window.location.search) ? window.location.search : '';
            if (path.endsWith('/popup.html') || path.endsWith('popup.html')) {
                return search.includes('options=true') ? 'OPTIONS_TAB' : 'POPUP';
            }
            if (path.endsWith('/download.html') || path.endsWith('download.html')) return 'DOWNLOAD_MANAGER';
            if (path.endsWith('/offscreen.html') || path.endsWith('offscreen.html')) return 'OFFSCREEN';
            if (path.endsWith('/stream_processor.html') || path.endsWith('stream_processor.html')) return 'STREAM_PROCESSOR';
            if (path.endsWith('/audio_processor.html') || path.endsWith('audio_processor.html')) return 'AUDIO_PROCESSOR';
            if (window.location && (window.location.protocol === 'moz-extension:' || window.location.protocol === 'chrome-extension:')) {
                return 'BACKGROUND_PAGE';
            }
            return 'CONTENT_SCRIPT';
        } catch (_) {
            return 'UNKNOWN_CONTEXT';
        }
    }

    const CONTEXT_NAME = detectContextName();
    const SESSION_ID = startWallTime.toString(36) + '-' + Math.random().toString(36).slice(2, 6);

    const originalConsole = {
        log: console.log ? console.log.bind(console) : () => {},
        info: console.info ? console.info.bind(console) : () => {},
        warn: console.warn ? console.warn.bind(console) : () => {},
        error: console.error ? console.error.bind(console) : () => {},
        debug: console.debug ? console.debug.bind(console) : () => {}
    };

    const memoryLogs = [];
    const pendingStorageLogs = [];
    let flushTimer = null;
    let isFlushing = false;
    let entrySeq = 0;

    function safeSerializeArg(arg, depth = 0) {
        if (arg === null) return 'null';
        if (arg === undefined) return 'undefined';
        const type = typeof arg;
        if (type === 'string') return arg.length > 2500 ? arg.slice(0, 2500) + '...[truncated]' : arg;
        if (type === 'number' || type === 'boolean' || type === 'bigint') return String(arg);
        if (type === 'symbol') return arg.toString();
        if (type === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
        if (arg instanceof Error) {
            return `${arg.name || 'Error'}: ${arg.message || ''}${arg.stack ? '\n' + arg.stack : ''}`;
        }
        if (typeof Element !== 'undefined' && arg instanceof Element) {
            const id = arg.id ? `#${arg.id}` : '';
            const cls = (typeof arg.className === 'string' && arg.className.trim())
                ? `.${arg.className.trim().split(/\s+/).join('.')}`
                : '';
            return `<${arg.tagName.toLowerCase()}${id}${cls}>`;
        }
        if (typeof Event !== 'undefined' && arg instanceof Event) {
            return `[Event type="${arg.type}" target=${safeSerializeArg(arg.target, depth + 1)}]`;
        }
        if (depth > 2) return '[Object]';
        try {
            const seen = new WeakSet();
            const json = JSON.stringify(arg, (key, value) => {
                if (/token|authorization|password|secret/i.test(key)) return '[REDACTED]';
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return '[Circular]';
                    seen.add(value);
                }
                if (value instanceof Error) {
                    return { name: value.name, message: value.message, stack: value.stack };
                }
                return value;
            });
            if (typeof json === 'string') {
                return json.length > 2500 ? json.slice(0, 2500) + '...[truncated]' : json;
            }
        } catch (_) {}
        try {
            return String(arg);
        } catch (_) {
            return '[Unserializable]';
        }
    }

    function recordLog(level, category, message, details = null) {
        const now = new Date();
        let formattedMsg = typeof message === 'string' ? message : safeSerializeArg(message);
        if (details !== null && details !== undefined) {
            const detailStr = typeof details === 'string' ? details : safeSerializeArg(details);
            if (detailStr) formattedMsg += ' | ' + detailStr;
        }
        const entry = {
            id: `${SESSION_ID}:${++entrySeq}`,
            ts: now.toISOString(),
            epoch: now.getTime(),
            relMs: getPerfDeltaMs(),
            ctx: CONTEXT_NAME,
            lvl: String(level || 'INFO').toUpperCase(),
            cat: String(category || 'GENERAL').toUpperCase(),
            msg: formattedMsg
        };

        memoryLogs.push(entry);
        if (memoryLogs.length > MAX_MEMORY_ENTRIES) {
            memoryLogs.splice(0, memoryLogs.length - MAX_MEMORY_ENTRIES);
        }

        pendingStorageLogs.push(entry);
        if (pendingStorageLogs.length > MAX_MEMORY_ENTRIES) {
            pendingStorageLogs.splice(0, pendingStorageLogs.length - MAX_MEMORY_ENTRIES);
        }

        scheduleFlush();
        return entry;
    }

    function scheduleFlush() {
        if (!extBrowser || !extBrowser.storage || !extBrowser.storage.local) return;
        if (flushTimer !== null) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushLogsToStorage();
        }, FLUSH_DEBOUNCE_MS);
    }

    async function flushLogsToStorage() {
        if (isFlushing || pendingStorageLogs.length === 0) return;
        if (!extBrowser || !extBrowser.storage || !extBrowser.storage.local) return;
        isFlushing = true;
        const batch = pendingStorageLogs.splice(0, pendingStorageLogs.length);
        try {
            const res = await extBrowser.storage.local.get(STORAGE_KEY);
            const existing = Array.isArray(res && res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
            const combined = existing.concat(batch);
            if (combined.length > MAX_STORAGE_ENTRIES) {
                combined.splice(0, combined.length - MAX_STORAGE_ENTRIES);
            }
            await extBrowser.storage.local.set({ [STORAGE_KEY]: combined });
        } catch (err) {
            originalConsole.warn('[WMD DebugLogger] Failed to flush logs to storage:', err);
        } finally {
            isFlushing = false;
            if (pendingStorageLogs.length > 0) {
                scheduleFlush();
            }
        }
    }

    // Intercept Console Methods
    ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
        const orig = originalConsole[method];
        console[method] = function (...args) {
            try {
                const serialized = args.map(a => safeSerializeArg(a)).join(' ');
                recordLog(method.toUpperCase(), 'CONSOLE', serialized);
            } catch (_) {}
            return orig.apply(console, args);
        };
    });

    // Global Error & Rejection Listeners
    if (typeof globalScope.addEventListener === 'function') {
        globalScope.addEventListener('error', (event) => {
            try {
                const target = event.target;
                if (target && target !== globalScope && target !== window && target.tagName) {
                    const tag = target.tagName.toLowerCase();
                    const url = target.href || target.src || '';
                    recordLog('ERROR', 'RESOURCE_LOAD', `Failed to load <${tag}> resource`, {
                        tag,
                        url,
                        id: target.id || null,
                        className: target.className || null,
                        rel: target.rel || null
                    });
                } else {
                    recordLog('ERROR', 'UNCAUGHT_ERROR', event.message || 'Uncaught error', {
                        filename: event.filename || null,
                        lineno: event.lineno || null,
                        colno: event.colno || null,
                        stack: event.error && event.error.stack ? event.error.stack : null
                    });
                }
            } catch (_) {}
        }, true);

        globalScope.addEventListener('unhandledrejection', (event) => {
            try {
                recordLog('ERROR', 'UNHANDLED_REJECTION', 'Unhandled Promise Rejection', {
                    reason: safeSerializeArg(event.reason)
                });
            } catch (_) {}
        });
    }

    // Storage Change Listener
    if (extBrowser && extBrowser.storage && extBrowser.storage.onChanged) {
        try {
            extBrowser.storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== 'local') return;
                const keys = Object.keys(changes).filter(k => k !== STORAGE_KEY);
                if (keys.length === 0) return;
                const summary = {};
                for (const k of keys) {
                    if (/token|authorization|password|secret/i.test(k)) {
                        summary[k] = { oldValue: '[REDACTED]', newValue: '[REDACTED]' };
                    } else if (k === 'download_history' || k.startsWith('tab_media_') || k.startsWith('yt_data_')) {
                        const oldLen = Array.isArray(changes[k].oldValue) ? changes[k].oldValue.length : (changes[k].oldValue ? 1 : 0);
                        const newLen = Array.isArray(changes[k].newValue) ? changes[k].newValue.length : (changes[k].newValue ? 1 : 0);
                        summary[k] = `[Collection count: ${oldLen} -> ${newLen}]`;
                    } else {
                        summary[k] = {
                            oldValue: changes[k].oldValue,
                            newValue: changes[k].newValue
                        };
                    }
                }
                recordLog('DEBUG', 'STORAGE_CHANGE', `Updated keys (${keys.join(', ')})`, summary);
            });
        } catch (_) {}
    }

    // CSS & DOM Inspection Helpers
    function inspectStyleSheets() {
        if (typeof document === 'undefined' || !document.styleSheets) return [];
        const sheets = [];
        for (let i = 0; i < document.styleSheets.length; i++) {
            const sheet = document.styleSheets[i];
            const info = {
                index: i,
                href: sheet.href || 'inline-<style>',
                ownerTag: sheet.ownerNode ? sheet.ownerNode.tagName.toLowerCase() : null,
                disabled: Boolean(sheet.disabled),
                media: sheet.media && sheet.media.mediaText ? sheet.media.mediaText : 'all',
                rulesCount: null,
                status: 'unknown',
                sampleRules: []
            };
            try {
                const rules = sheet.cssRules || sheet.rules;
                info.rulesCount = rules ? rules.length : 0;
                info.status = 'loaded';
                if (rules && rules.length > 0) {
                    const maxSample = Math.min(3, rules.length);
                    for (let r = 0; r < maxSample; r++) {
                        const cssText = rules[r].cssText || '';
                        info.sampleRules.push(cssText.length > 120 ? cssText.slice(0, 120) + '...' : cssText);
                    }
                }
            } catch (err) {
                info.status = `cross-origin or inaccessible (${err.name || err.message})`;
            }
            sheets.push(info);
        }
        return sheets;
    }

    const resizeTimeline = [];
    const MAX_RESIZE_TIMELINE = 60;

    function parseCssZoomFactor(zoomValue) {
        if (!zoomValue || zoomValue === 'normal') return 1;
        const str = String(zoomValue).trim();
        if (str.endsWith('%')) {
            const num = parseFloat(str);
            return Number.isFinite(num) && num > 0 ? num / 100 : 1;
        }
        const num = parseFloat(str);
        return Number.isFinite(num) && num > 0 ? num : 1;
    }

    function inspectPopupCutoffDiagnostics(triggerPhase = 'snapshot') {
        if (typeof window === 'undefined' || typeof document === 'undefined' || !document.documentElement) {
            return null;
        }
        const htmlEl = document.documentElement;
        const bodyEl = document.body;
        const vv = window.visualViewport || null;

        let htmlCs = null;
        let bodyCs = null;
        try { htmlCs = window.getComputedStyle(htmlEl); } catch (_) {}
        try { if (bodyEl) bodyCs = window.getComputedStyle(bodyEl); } catch (_) {}

        const zoomRaw = (htmlCs && htmlCs.zoom) || htmlEl.style.zoom || '100%';
        const zoomFactor = parseCssZoomFactor(zoomRaw);

        const htmlRect = htmlEl.getBoundingClientRect ? htmlEl.getBoundingClientRect() : null;
        const bodyRect = (bodyEl && bodyEl.getBoundingClientRect) ? bodyEl.getBoundingClientRect() : null;

        const winInnerW = window.innerWidth || 0;
        const winInnerH = window.innerHeight || 0;
        const vvW = vv ? Number(vv.width.toFixed(2)) : winInnerW;
        const vvH = vv ? Number(vv.height.toFixed(2)) : winInnerH;

        const effectiveViewportW = vvW || winInnerW;
        const effectiveViewportH = vvH || winInnerH;

        const expectedRenderedW = Math.round(550 * zoomFactor);
        const expectedRenderedH = Math.round(600 * zoomFactor);

        const htmlOverflowX = htmlCs ? (htmlCs.overflowX || htmlCs.overflow) : '';
        const htmlOverflowY = htmlCs ? (htmlCs.overflowY || htmlCs.overflow) : '';
        const bodyOverflowX = bodyCs ? (bodyCs.overflowX || bodyCs.overflow) : '';
        const bodyOverflowY = bodyCs ? (bodyCs.overflowY || bodyCs.overflow) : '';

        const isPopupClass = htmlEl.classList.contains('is-popup');
        const isMobileClass = htmlEl.classList.contains('is-mobile');
        const isTabClass = htmlEl.classList.contains('is-tab');

        const cutoffWarnings = [];
        const clippedElements = [];

        if (htmlRect && effectiveViewportW > 0 && effectiveViewportH > 0) {
            const rightOverflowPx = Math.round(htmlRect.width - effectiveViewportW);
            const bottomOverflowPx = Math.round(htmlRect.height - effectiveViewportH);
            if (rightOverflowPx > 2) {
                cutoffWarnings.push(`HTML bounding width (${Math.round(htmlRect.width)}px) exceeds visual viewport width (${effectiveViewportW}px) by ${rightOverflowPx}px`);
            }
            if (bottomOverflowPx > 2 && (htmlOverflowY === 'hidden' || bodyOverflowY === 'hidden')) {
                cutoffWarnings.push(`HTML bounding height (${Math.round(htmlRect.height)}px) exceeds visual viewport height (${effectiveViewportH}px) by ${bottomOverflowPx}px with overflow hidden`);
            }
        }

        if (htmlEl.scrollWidth > htmlEl.clientWidth + 2) {
            cutoffWarnings.push(`Horizontal scroll overflow on <html>: scrollWidth (${htmlEl.scrollWidth}px) > clientWidth (${htmlEl.clientWidth}px) (overflowX=${htmlOverflowX})`);
        }
        if (bodyEl && bodyEl.scrollWidth > bodyEl.clientWidth + 2) {
            cutoffWarnings.push(`Horizontal scroll overflow on <body>: scrollWidth (${bodyEl.scrollWidth}px) > clientWidth (${bodyEl.clientWidth}px) (overflowX=${bodyOverflowX})`);
        }

        if (isPopupClass && !isMobileClass && !isTabClass && effectiveViewportW > 0) {
            if (effectiveViewportW < expectedRenderedW - 4 && effectiveViewportW < 546) {
                cutoffWarnings.push(`Popup window innerWidth (${effectiveViewportW}px) is narrower than expected popup width (${expectedRenderedW}px at zoom ${zoomRaw} / 550px base)`);
            }
            if (effectiveViewportH < expectedRenderedH - 4 && effectiveViewportH < 596) {
                cutoffWarnings.push(`Popup window innerHeight (${effectiveViewportH}px) is shorter than expected popup height (${expectedRenderedH}px at zoom ${zoomRaw} / 600px base)`);
            }
        }

        // Check if mobile screen is treated as fixed 550x600 desktop popup, or desktop screen is misclassified as mobile
        const scrW = (window.screen && window.screen.availWidth) ? window.screen.availWidth : 0;
        const isDesktopOS = /Win|Mac|Linux/i.test(navigator.platform || '') && !(/Android/i.test(navigator.userAgent || '')) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isPopupClass && !isMobileClass && scrW > 0 && scrW < 550) {
            cutoffWarnings.push(`Screen availWidth (${scrW}px) is smaller than 550px, but 'is-mobile' class is NOT active on <html>!`);
        }
        if (isPopupClass && isMobileClass && isDesktopOS) {
            cutoffWarnings.push(`Desktop OS (${navigator.platform}) has 'is-mobile' class active on <html>, causing popup width collapse (innerWidth=${effectiveViewportW}px)!`);
        }

        // Check key interactive elements for right/bottom clipping
        const checkSelectors = [
            '#main-content',
            '#navbar',
            'mdui-tab[value="home"]',
            'mdui-tab[value="history"]',
            'mdui-tab[value="about"]',
            'mdui-tab[value="settings"]',
            '#settings-container',
            '.settings-tabs-header',
            '.settings-sidebar-nav',
            '#media-list',
            '#selection-bar',
            '#settings-apply-bar'
        ];

        for (const sel of checkSelectors) {
            try {
                const el = document.querySelector(sel);
                if (!el || !el.getBoundingClientRect) continue;
                const cs = window.getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;

                const visualRight = Math.round(r.right * zoomFactor);
                const rawRight = Math.round(r.right);
                const rawLeft = Math.round(r.left);
                const rawBottom = Math.round(r.bottom);

                const isClippedRight = rawRight > effectiveViewportW + 4 && visualRight > effectiveViewportW + 4;
                const isClippedLeft = rawLeft < -4;

                if (isClippedRight || isClippedLeft) {
                    clippedElements.push({
                        selector: sel,
                        rect: {
                            left: rawLeft,
                            top: Math.round(r.top),
                            right: rawRight,
                            bottom: rawBottom,
                            width: Math.round(r.width),
                            height: Math.round(r.height)
                        },
                        scrollWidth: el.scrollWidth,
                        clientWidth: el.clientWidth,
                        viewportWidth: effectiveViewportW,
                        reason: isClippedRight ? 'exceeds-right-viewport-edge' : 'exceeds-left-viewport-edge'
                    });
                }
            } catch (_) {}
        }

        if (clippedElements.length > 0) {
            cutoffWarnings.push(`${clippedElements.length} UI element(s) extend outside the visible horizontal viewport`);
        }

        return {
            phase: triggerPhase,
            relMs: getPerfDeltaMs(),
            cutoffDetected: cutoffWarnings.length > 0,
            cutoffWarnings,
            clippedElements,
            modeFlags: {
                isPopupClass,
                isMobileClass,
                isTabClass,
                maxTouchPoints: (typeof navigator !== 'undefined') ? (navigator.maxTouchPoints ?? null) : null
            },
            zoom: {
                inlineStyleZoom: htmlEl.style.zoom || null,
                computedZoom: zoomRaw,
                zoomFactor
            },
            dimensions: {
                windowInner: { width: winInnerW, height: winInnerH },
                windowOuter: { width: window.outerWidth || 0, height: window.outerHeight || 0 },
                visualViewport: vv ? {
                    width: vvW,
                    height: vvH,
                    scale: Number((vv.scale || 1).toFixed(3)),
                    offsetLeft: Number((vv.offsetLeft || 0).toFixed(2)),
                    offsetTop: Number((vv.offsetTop || 0).toFixed(2)),
                    pageLeft: Number((vv.pageLeft || 0).toFixed(2)),
                    pageTop: Number((vv.pageTop || 0).toFixed(2))
                } : null,
                screen: (typeof window.screen !== 'undefined') ? {
                    width: window.screen.width,
                    height: window.screen.height,
                    availWidth: window.screen.availWidth,
                    availHeight: window.screen.availHeight
                } : null,
                devicePixelRatio: window.devicePixelRatio || 1,
                htmlClient: { width: htmlEl.clientWidth, height: htmlEl.clientHeight },
                htmlScroll: { width: htmlEl.scrollWidth, height: htmlEl.scrollHeight },
                htmlOffset: { width: htmlEl.offsetWidth, height: htmlEl.offsetHeight },
                htmlBoundingRect: htmlRect ? {
                    width: Number(htmlRect.width.toFixed(2)),
                    height: Number(htmlRect.height.toFixed(2)),
                    right: Number(htmlRect.right.toFixed(2)),
                    bottom: Number(htmlRect.bottom.toFixed(2))
                } : null,
                bodyClient: bodyEl ? { width: bodyEl.clientWidth, height: bodyEl.clientHeight } : null,
                bodyScroll: bodyEl ? { width: bodyEl.scrollWidth, height: bodyEl.scrollHeight } : null,
                bodyOffset: bodyEl ? { width: bodyEl.offsetWidth, height: bodyEl.offsetHeight } : null,
                bodyBoundingRect: bodyRect ? {
                    width: Number(bodyRect.width.toFixed(2)),
                    height: Number(bodyRect.height.toFixed(2)),
                    right: Number(bodyRect.right.toFixed(2)),
                    bottom: Number(bodyRect.bottom.toFixed(2))
                } : null,
                expectedPopupBase: { width: 550, height: 600 },
                expectedPopupZoomScaled: { width: expectedRenderedW, height: expectedRenderedH }
            },
            overflowState: {
                htmlOverflowX,
                htmlOverflowY,
                bodyOverflowX,
                bodyOverflowY
            }
        };
    }

    function recordPopupGeometrySnapshot(phase) {
        if (typeof window === 'undefined' || typeof document === 'undefined') return null;
        const diag = inspectPopupCutoffDiagnostics(phase);
        if (!diag) return null;

        const compactEntry = {
            ts: new Date().toISOString(),
            relMs: diag.relMs,
            phase,
            inner: `${diag.dimensions.windowInner.width}x${diag.dimensions.windowInner.height}`,
            outer: `${diag.dimensions.windowOuter.width}x${diag.dimensions.windowOuter.height}`,
            visualVp: diag.dimensions.visualViewport
                ? `${diag.dimensions.visualViewport.width}x${diag.dimensions.visualViewport.height}@${diag.dimensions.visualViewport.scale}x`
                : null,
            htmlClient: `${diag.dimensions.htmlClient.width}x${diag.dimensions.htmlClient.height}`,
            htmlScroll: `${diag.dimensions.htmlScroll.width}x${diag.dimensions.htmlScroll.height}`,
            htmlRect: diag.dimensions.htmlBoundingRect
                ? `${diag.dimensions.htmlBoundingRect.width}x${diag.dimensions.htmlBoundingRect.height}`
                : null,
            bodyRect: diag.dimensions.bodyBoundingRect
                ? `${diag.dimensions.bodyBoundingRect.width}x${diag.dimensions.bodyBoundingRect.height}`
                : null,
            dpr: diag.dimensions.devicePixelRatio,
            zoom: diag.zoom.computedZoom,
            classes: Array.from(document.documentElement.classList || []).join('.'),
            cutoffDetected: diag.cutoffDetected,
            warnings: diag.cutoffWarnings
        };

        resizeTimeline.push(compactEntry);
        if (resizeTimeline.length > MAX_RESIZE_TIMELINE) {
            resizeTimeline.splice(0, resizeTimeline.length - MAX_RESIZE_TIMELINE);
        }

        if (diag.cutoffDetected) {
            recordLog('WARN', 'POPUP_CUTOFF_CHECK', `Potential UI cutoff/overflow detected at [${phase}]`, compactEntry);
        } else {
            recordLog('DEBUG', 'VIEWPORT_GEOMETRY', `Viewport geometry snapshot at [${phase}]`, compactEntry);
        }
        return diag;
    }

    function inspectComputedThemeAndLayout() {
        if (typeof window === 'undefined' || typeof document === 'undefined' || !document.documentElement) {
            return null;
        }
        const htmlEl = document.documentElement;
        const bodyEl = document.body;
        const result = {
            readyState: document.readyState,
            compatMode: document.compatMode,
            characterSet: document.characterSet,
            visibilityState: document.visibilityState,
            htmlClasses: Array.from(htmlEl.classList || []),
            htmlInlineStyle: htmlEl.getAttribute('style') || '',
            bodyClasses: bodyEl ? Array.from(bodyEl.classList || []) : [],
            bodyInlineStyle: bodyEl ? (bodyEl.getAttribute('style') || '') : '',
            viewport: {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                outerWidth: window.outerWidth,
                outerHeight: window.outerHeight,
                devicePixelRatio: window.devicePixelRatio,
                clientWidth: htmlEl.clientWidth,
                clientHeight: htmlEl.clientHeight,
                scrollWidth: htmlEl.scrollWidth,
                scrollHeight: htmlEl.scrollHeight
            },
            htmlComputed: {},
            bodyComputed: {},
            cssVariables: {},
            keyElements: {},
            customElementsRegistered: {}
        };

        try {
            const htmlCs = window.getComputedStyle(htmlEl);
            result.htmlComputed = {
                width: htmlCs.width,
                height: htmlCs.height,
                zoom: htmlCs.zoom || htmlEl.style.zoom || 'normal',
                fontSize: htmlCs.fontSize,
                fontFamily: htmlCs.fontFamily,
                color: htmlCs.color,
                backgroundColor: htmlCs.backgroundColor,
                colorScheme: htmlCs.colorScheme || 'normal',
                overflow: htmlCs.overflow
            };
            const cssVarNames = [
                '--mdui-color-primary',
                '--mdui-color-on-primary',
                '--mdui-color-primary-container',
                '--mdui-color-secondary',
                '--mdui-color-surface',
                '--mdui-color- surface-container',
                '--mdui-color-on-surface',
                '--mdui-color-on-surface-variant',
                '--mdui-color-background',
                '--mdui-color-outline',
                '--mdui-color-outline-variant',
                '--mdui-color-error',
                '--dm-max-width',
                '--dm-radius'
            ];
            for (const varName of cssVarNames) {
                const cleanName = varName.replace(/\s+/g, '');
                const val = htmlCs.getPropertyValue(cleanName).trim();
                if (val) result.cssVariables[cleanName] = val;
            }
        } catch (_) {}

        if (bodyEl) {
            try {
                const bodyCs = window.getComputedStyle(bodyEl);
                result.bodyComputed = {
                    display: bodyCs.display,
                    width: bodyCs.width,
                    height: bodyCs.height,
                    minHeight: bodyCs.minHeight,
                    margin: bodyCs.margin,
                    padding: bodyCs.padding,
                    color: bodyCs.color,
                    backgroundColor: bodyCs.backgroundColor,
                    fontFamily: bodyCs.fontFamily,
                    fontSize: bodyCs.fontSize,
                    lineHeight: bodyCs.lineHeight,
                    overflowX: bodyCs.overflowX,
                    overflowY: bodyCs.overflowY
                };
            } catch (_) {}
        }

        const keySelectors = [
            '#loading',
            '#main-content',
            '#navbar',
            '#media-list',
            '#history-list',
            '#settings-container',
            '#downloads-list',
            '#welcome-overlay',
            '#reinstall-overlay'
        ];
        for (const sel of keySelectors) {
            try {
                const el = document.querySelector(sel);
                if (el) {
                    const cs = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    result.keyElements[sel] = {
                        tag: el.tagName.toLowerCase(),
                        classes: Array.from(el.classList || []),
                        display: cs.display,
                        visibility: cs.visibility,
                        opacity: cs.opacity,
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        childCount: el.children ? el.children.length : 0
                    };
                }
            } catch (_) {}
        }

        if (typeof customElements !== 'undefined' && typeof customElements.get === 'function') {
            const mduiTags = [
                'mdui-tabs',
                'mdui-tab',
                'mdui-tab-panel',
                'mdui-button',
                'mdui-button-icon',
                'mdui-switch',
                'mdui-checkbox',
                'mdui-circular-progress',
                'mdui-linear-progress',
                'mdui-icon',
                'mdui-bottom-app-bar'
            ];
            for (const tag of mduiTags) {
                result.customElementsRegistered[tag] = Boolean(customElements.get(tag));
            }
        }

        return result;
    }

    function inspectResourceTimings() {
        if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
            return [];
        }
        try {
            const entries = performance.getEntriesByType('resource') || [];
            return entries.slice(0, 150).map(e => ({
                name: e.name ? e.name.replace(/^(chrome-extension|moz-extension):\/\/[^/]+\//, 'ext://') : '',
                initiatorType: e.initiatorType || 'other',
                durationMs: Number((e.duration || 0).toFixed(2)),
                startTimeMs: Number((e.startTime || 0).toFixed(2)),
                transferSize: e.transferSize ?? null,
                decodedBodySize: e.decodedBodySize ?? null,
                responseStatus: e.responseStatus ?? null
            }));
        } catch (_) {
            return [];
        }
    }

    // Track early startup, <link>/<style>/<script> tags, and DOM lifecycle in Window contexts
    function setupDomStartupTracking() {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        const trackedNodes = new WeakSet();

        function attachAssetListeners(node, sourcePhase) {
            if (!node || trackedNodes.has(node) || !node.tagName) return;
            const tag = node.tagName.toLowerCase();
            if (tag !== 'link' && tag !== 'style' && tag !== 'script') return;
            trackedNodes.add(node);

            if (tag === 'link') {
                const rel = node.getAttribute('rel') || '';
                const href = node.getAttribute('href') || '';
                recordLog('DEBUG', 'CSS_LINK_DETECTED', `<link rel="${rel}" href="${href}"> (${sourcePhase})`, {
                    sheetLoaded: Boolean(node.sheet),
                    disabled: Boolean(node.disabled)
                });
                node.addEventListener('load', () => {
                    let rulesCount = null;
                    try {
                        rulesCount = node.sheet && node.sheet.cssRules ? node.sheet.cssRules.length : null;
                    } catch (_) {}
                    recordLog('INFO', 'CSS_LOADED', `Stylesheet loaded: ${href}`, {
                        rulesCount,
                        disabled: Boolean(node.disabled)
                    });
                });
                node.addEventListener('error', () => {
                    recordLog('ERROR', 'CSS_ERROR', `Stylesheet FAILED to load: ${href}`);
                });
            } else if (tag === 'style') {
                const textLen = (node.textContent || '').length;
                recordLog('DEBUG', 'CSS_STYLE_TAG', `Inline <style> tag detected (${sourcePhase}, ${textLen} chars)`);
            } else if (tag === 'script') {
                const src = node.getAttribute('src') || 'inline-<script>';
                recordLog('DEBUG', 'SCRIPT_DETECTED', `<script src="${src}"> (${sourcePhase})`, {
                    async: Boolean(node.async),
                    defer: Boolean(node.defer),
                    type: node.type || 'text/javascript'
                });
                if (node.getAttribute('src')) {
                    node.addEventListener('load', () => {
                        recordLog('INFO', 'SCRIPT_LOADED', `Script loaded: ${src}`);
                    });
                    node.addEventListener('error', () => {
                        recordLog('ERROR', 'SCRIPT_ERROR', `Script FAILED to load: ${src}`);
                    });
                }
            }
        }

        // Scan existing head/document nodes right now
        const initialNodes = document.querySelectorAll('link, style, script');
        initialNodes.forEach(node => attachAssetListeners(node, 'initial-scan'));

        // Observe new <link>, <style>, <script> and CSS class/style mutations on root and key containers
        if (typeof MutationObserver === 'function' && document.documentElement) {
            try {
                const keyIds = new Set([
                    'loading',
                    'main-content',
                    'navbar',
                    'media-list',
                    'history-list',
                    'settings-container',
                    'downloads-list',
                    'welcome-overlay',
                    'reinstall-overlay',
                    'update-notification',
                    'settings-apply-bar'
                ]);
                let styleAttrLogCount = 0;

                const observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        if (mutation.type === 'attributes') {
                            const target = mutation.target;
                            if (!target || !target.tagName) continue;
                            const tag = target.tagName.toLowerCase();
                            const id = target.id || '';
                            const isRoot = (target === document.documentElement || target === document.body);
                            const isKeyContainer = keyIds.has(id) || tag === 'mdui-tabs' || tag === 'mdui-tab-panel';

                            if (isRoot || (isKeyContainer && styleAttrLogCount < 250)) {
                                styleAttrLogCount++;
                                const attr = mutation.attributeName;
                                const oldVal = mutation.oldValue;
                                const newVal = target.getAttribute(attr);
                                if (oldVal !== newVal) {
                                    const selector = `${tag}${id ? '#' + id : ''}`;
                                    recordLog('DEBUG', 'CSS_DOM_MUTATION', `${selector} [${attr}] changed`, {
                                        from: oldVal,
                                        to: newVal
                                    });
                                    if (isRoot && (attr === 'class' || attr === 'style')) {
                                        recordPopupGeometrySnapshot(`root-${tag}-${attr}-change`);
                                    }
                                }
                            }
                        } else if (mutation.type === 'characterData') {
                            const parent = mutation.target && mutation.target.parentNode;
                            if (parent && parent.tagName && parent.tagName.toLowerCase() === 'style') {
                                recordLog('DEBUG', 'CSS_STYLE_UPDATED', 'Inline <style> content modified dynamically', {
                                    id: parent.id || null,
                                    length: (parent.textContent || '').length
                                });
                            }
                        } else if (mutation.type === 'childList') {
                            if (mutation.target && mutation.target.tagName && mutation.target.tagName.toLowerCase() === 'style') {
                                recordLog('DEBUG', 'CSS_STYLE_UPDATED', 'Inline <style> child text updated', {
                                    id: mutation.target.id || null,
                                    length: (mutation.target.textContent || '').length
                                });
                            }
                            for (const added of mutation.addedNodes) {
                                if (added && added.nodeType === 1) {
                                    attachAssetListeners(added, 'mutation-observer');
                                    if (added.querySelectorAll) {
                                        added.querySelectorAll('link, style, script').forEach(child => {
                                            attachAssetListeners(child, 'mutation-observer-child');
                                        });
                                    }
                                }
                            }
                        }
                    }
                });
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    attributes: true,
                    attributeOldValue: true,
                    attributeFilter: ['class', 'style', 'data-theme', 'value', 'hidden']
                });
            } catch (_) {}
        }

        // Intercept dynamic CSSOM rule insertions/deletions (CSSStyleSheet.prototype.insertRule / deleteRule)
        if (typeof CSSStyleSheet !== 'undefined' && CSSStyleSheet.prototype) {
            try {
                let cssRuleLogCount = 0;
                const origInsertRule = CSSStyleSheet.prototype.insertRule;
                if (typeof origInsertRule === 'function') {
                    CSSStyleSheet.prototype.insertRule = function (rule, index) {
                        const res = origInsertRule.apply(this, arguments);
                        if (++cssRuleLogCount <= 100) {
                            recordLog('DEBUG', 'CSSOM_INSERT_RULE', 'CSS rule inserted via CSSOM', {
                                href: this.href || 'inline/constructed',
                                index: index ?? 0,
                                rule: typeof rule === 'string' ? rule.slice(0, 160) : ''
                            });
                        }
                        return res;
                    };
                }
                const origDeleteRule = CSSStyleSheet.prototype.deleteRule;
                if (typeof origDeleteRule === 'function') {
                    CSSStyleSheet.prototype.deleteRule = function (index) {
                        if (++cssRuleLogCount <= 100) {
                            recordLog('DEBUG', 'CSSOM_DELETE_RULE', 'CSS rule deleted via CSSOM', {
                                href: this.href || 'inline/constructed',
                                index
                            });
                        }
                        return origDeleteRule.apply(this, arguments);
                    };
                }
            } catch (_) {}
        }

        document.addEventListener('readystatechange', () => {
            recordLog('INFO', 'LIFECYCLE', `document.readyState changed to "${document.readyState}"`);
            recordPopupGeometrySnapshot(`readystatechange:${document.readyState}`);
        });

        window.addEventListener('resize', () => {
            recordPopupGeometrySnapshot('window.resize');
        });

        if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
            window.visualViewport.addEventListener('resize', () => {
                recordPopupGeometrySnapshot('visualViewport.resize');
            });
        }

        if (typeof ResizeObserver === 'function' && document.documentElement) {
            try {
                let roCount = 0;
                const ro = new ResizeObserver((entries) => {
                    if (++roCount <= 25) {
                        const rect = entries[0] && entries[0].contentRect
                            ? `${Math.round(entries[0].contentRect.width)}x${Math.round(entries[0].contentRect.height)}`
                            : 'unknown';
                        recordPopupGeometrySnapshot(`ResizeObserver:html(${rect})`);
                    }
                });
                ro.observe(document.documentElement);
            } catch (_) {}
        }

        // Scheduled early checkpoints to catch popup opening animation / zoom race conditions
        [0, 50, 150, 350, 800, 1500].forEach((delayMs) => {
            setTimeout(() => {
                recordPopupGeometrySnapshot(`checkpoint:${delayMs}ms`);
            }, delayMs);
        });

        window.addEventListener('DOMContentLoaded', () => {
            const sheets = inspectStyleSheets();
            const layout = inspectComputedThemeAndLayout();
            const cutoffDiag = recordPopupGeometrySnapshot('DOMContentLoaded');
            recordLog('INFO', 'DOM_CONTENT_LOADED', 'DOMContentLoaded fired', {
                styleSheetsCount: sheets.length,
                styleSheets: sheets.map(s => ({ href: s.href, rulesCount: s.rulesCount, status: s.status })),
                htmlClasses: layout ? layout.htmlClasses : [],
                htmlZoom: layout && layout.htmlComputed ? layout.htmlComputed.zoom : null,
                cutoffDetected: cutoffDiag ? cutoffDiag.cutoffDetected : false,
                cutoffWarnings: cutoffDiag ? cutoffDiag.cutoffWarnings : [],
                themeVars: layout ? layout.cssVariables : {}
            });
        });

        window.addEventListener('load', () => {
            const sheets = inspectStyleSheets();
            const layout = inspectComputedThemeAndLayout();
            const resources = inspectResourceTimings();
            const cutoffDiag = recordPopupGeometrySnapshot('window.load');
            recordLog('INFO', 'WINDOW_LOAD', 'Window load completed (all CSS, scripts, and subresources finished)', {
                styleSheetsCount: sheets.length,
                styleSheets: sheets,
                computedLayout: layout,
                cutoffDiagnostics: cutoffDiag,
                resourcesLoadedCount: resources.length
            });
            flushLogsToStorage();
        });

        window.addEventListener('pagehide', () => {
            recordLog('DEBUG', 'LIFECYCLE', 'Window pagehide / closing');
            flushLogsToStorage();
        });
    }

    // Log Immediate Context Startup
    recordLog('INFO', 'STARTUP', `Logger initialized in context [${CONTEXT_NAME}]`, {
        sessionId: SESSION_ID,
        href: (typeof location !== 'undefined' && location.href) ? location.href : 'worker',
        readyState: (typeof document !== 'undefined' && document.readyState) ? document.readyState : 'n/a',
        userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : 'unknown'
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        setupDomStartupTracking();
    }

    // Browser, OS, Hardware, & Extension Spec Collector
    async function collectBrowserAndSystemSpecs() {
        const specs = {
            collectedAt: new Date().toISOString(),
            context: CONTEXT_NAME,
            extension: {},
            browser: {},
            userAgentData: null,
            platformInfo: null,
            hardwareAndDevice: {},
            screenAndViewport: {},
            graphicsWebGL: null,
            networkInfo: null,
            storageQuota: null,
            mediaCapabilities: {}
        };

        // 1. Extension Manifest & Runtime Info
        try {
            if (extBrowser && extBrowser.runtime) {
                const manifest = typeof extBrowser.runtime.getManifest === 'function'
                    ? extBrowser.runtime.getManifest()
                    : null;
                specs.extension = {
                    id: extBrowser.runtime.id || null,
                    baseUrl: typeof extBrowser.runtime.getURL === 'function' ? extBrowser.runtime.getURL('') : null,
                    name: manifest ? manifest.name : null,
                    version: manifest ? manifest.version : null,
                    manifestVersion: manifest ? manifest.manifest_version : null,
                    edition: manifest && manifest.name && manifest.name.includes('Light') ? 'Light' : 'Full',
                    backgroundType: manifest && manifest.background
                        ? (manifest.background.service_worker ? 'service_worker' : 'scripts')
                        : null,
                    permissions: manifest ? (manifest.permissions || []) : [],
                    hostPermissions: manifest ? (manifest.host_permissions || []) : []
                };
            }
        } catch (e) {
            specs.extension.error = e.message;
        }

        // 2. Platform Info from Browser Runtime
        try {
            if (extBrowser && extBrowser.runtime && typeof extBrowser.runtime.getPlatformInfo === 'function') {
                specs.platformInfo = await extBrowser.runtime.getPlatformInfo();
            }
        } catch (e) {
            specs.platformInfo = { error: e.message };
        }

        // 3. Navigator & User-Agent Info
        if (typeof navigator !== 'undefined') {
            let timeZone = null;
            try {
                timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            } catch (_) {}
            specs.browser = {
                userAgent: navigator.userAgent || null,
                appVersion: navigator.appVersion || null,
                platform: navigator.platform || null,
                vendor: navigator.vendor || null,
                language: navigator.language || null,
                languages: Array.isArray(navigator.languages) ? Array.from(navigator.languages) : [],
                uiLocale: (extBrowser && extBrowser.i18n && typeof extBrowser.i18n.getUILanguage === 'function')
                    ? extBrowser.i18n.getUILanguage()
                    : null,
                timeZone,
                timeZoneOffsetMinutes: new Date().getTimezoneOffset(),
                cookieEnabled: Boolean(navigator.cookieEnabled),
                onLine: Boolean(navigator.onLine),
                pdfViewerEnabled: navigator.pdfViewerEnabled ?? null,
                webdriver: Boolean(navigator.webdriver),
                doNotTrack: navigator.doNotTrack || null
            };

            specs.hardwareAndDevice = {
                hardwareConcurrency: navigator.hardwareConcurrency ?? null,
                deviceMemoryGB: navigator.deviceMemory ?? null,
                maxTouchPoints: navigator.maxTouchPoints ?? null
            };

            if (typeof performance !== 'undefined' && performance.memory) {
                specs.hardwareAndDevice.jsHeapMemory = {
                    jsHeapSizeLimitBytes: performance.memory.jsHeapSizeLimit,
                    totalJSHeapSizeBytes: performance.memory.totalJSHeapSize,
                    usedJSHeapSizeBytes: performance.memory.usedJSHeapSize
                };
            }

            // High-entropy User-Agent Client Hints
            if (navigator.userAgentData) {
                try {
                    const basicUaData = {
                        mobile: navigator.userAgentData.mobile,
                        platform: navigator.userAgentData.platform,
                        brands: navigator.userAgentData.brands || []
                    };
                    if (typeof navigator.userAgentData.getHighEntropyValues === 'function') {
                        const highEntropy = await navigator.userAgentData.getHighEntropyValues([
                            'architecture',
                            'bitness',
                            'formFactors',
                            'fullVersionList',
                            'model',
                            'platformVersion',
                            'uaFullVersion',
                            'wow64'
                        ]);
                        specs.userAgentData = Object.assign(basicUaData, highEntropy);
                    } else {
                        specs.userAgentData = basicUaData;
                    }
                } catch (e) {
                    specs.userAgentData = { error: e.message };
                }
            }

            // Network Information API
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (conn) {
                specs.networkInfo = {
                    effectiveType: conn.effectiveType || null,
                    downlinkMbps: conn.downlink ?? null,
                    rttMs: conn.rtt ?? null,
                    saveData: Boolean(conn.saveData),
                    type: conn.type || null
                };
            }

            // Storage Manager Estimate
            if (navigator.storage && typeof navigator.storage.estimate === 'function') {
                try {
                    const estimate = await navigator.storage.estimate();
                    specs.storageQuota = {
                        usageBytes: estimate.usage ?? null,
                        quotaBytes: estimate.quota ?? null,
                        usagePercent: (estimate.usage && estimate.quota)
                            ? Number(((estimate.usage / estimate.quota) * 100).toFixed(2))
                            : null
                    };
                } catch (_) {}
            }
        }

        // 4. Screen & Viewport Specs
        if (typeof window !== 'undefined') {
            const scr = window.screen || {};
            specs.screenAndViewport = {
                screenWidth: scr.width ?? null,
                screenHeight: scr.height ?? null,
                availWidth: scr.availWidth ?? null,
                availHeight: scr.availHeight ?? null,
                colorDepth: scr.colorDepth ?? null,
                pixelDepth: scr.pixelDepth ?? null,
                orientation: (scr.orientation && scr.orientation.type) ? scr.orientation.type : null,
                devicePixelRatio: window.devicePixelRatio ?? null,
                windowInnerWidth: window.innerWidth ?? null,
                windowInnerHeight: window.innerHeight ?? null,
                windowOuterWidth: window.outerWidth ?? null,
                windowOuterHeight: window.outerHeight ?? null,
                prefersColorSchemeDark: (typeof window.matchMedia === 'function')
                    ? window.matchMedia('(prefers-color-scheme: dark)').matches
                    : null,
                prefersReducedMotion: (typeof window.matchMedia === 'function')
                    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    : null
            };
        }

        // 5. WebGL Renderer / GPU Info & Media Codec Support
        if (typeof document !== 'undefined') {
            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) {
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    specs.graphicsWebGL = {
                        version: gl.getParameter(gl.VERSION),
                        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
                        vendor: gl.getParameter(gl.VENDOR),
                        renderer: gl.getParameter(gl.RENDERER),
                        unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
                        unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null
                    };
                }
            } catch (_) {}

            try {
                const videoEl = document.createElement('video');
                if (videoEl && typeof videoEl.canPlayType === 'function') {
                    specs.mediaCapabilities = {
                        mp4H264: videoEl.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
                        mp4Hevc: videoEl.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"'),
                        mp4Av1: videoEl.canPlayType('video/mp4; codecs="av01.0.05M.08"'),
                        webmVp9: videoEl.canPlayType('video/webm; codecs="vp9, opus"'),
                        audioMp3: videoEl.canPlayType('audio/mpeg'),
                        audioOpus: videoEl.canPlayType('audio/ogg; codecs="opus"'),
                        audioAac: videoEl.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
                        webCodecsVideoEncoder: typeof VideoEncoder !== 'undefined',
                        webCodecsAudioEncoder: typeof AudioEncoder !== 'undefined',
                        mediaSourceSupported: typeof MediaSource !== 'undefined'
                    };
                }
            } catch (_) {}
        }

        return specs;
    }

    // Collect sanitized storage & settings snapshot
    async function collectStorageSnapshot() {
        const snapshot = {
            settings: {},
            storageSummary: {
                totalKeys: 0,
                tabMediaKeysCount: 0,
                ytDataKeysCount: 0,
                historyEntriesCount: 0
            }
        };
        if (!extBrowser || !extBrowser.storage || !extBrowser.storage.local) {
            return snapshot;
        }
        try {
            const allData = await extBrowser.storage.local.get(null);
            const keys = Object.keys(allData || {});
            snapshot.storageSummary.totalKeys = keys.length;

            for (const key of keys) {
                if (key === STORAGE_KEY) continue;
                const val = allData[key];
                if (/token|authorization|password|secret/i.test(key)) {
                    snapshot.settings[key] = val ? '[REDACTED_PRESENT]' : null;
                } else if (key === 'gdrive_user' || key === 'dropbox_user') {
                    snapshot.settings[key] = val ? { connected: true } : null;
                } else if (key === 'download_history') {
                    snapshot.storageSummary.historyEntriesCount = Array.isArray(val) ? val.length : 0;
                } else if (key.startsWith('tab_media_')) {
                    snapshot.storageSummary.tabMediaKeysCount++;
                } else if (key.startsWith('yt_data_')) {
                    snapshot.storageSummary.ytDataKeysCount++;
                } else {
                    snapshot.settings[key] = val;
                }
            }
        } catch (e) {
            snapshot.error = e.message;
        }
        return snapshot;
    }

    // Generate Complete Formatted Debug Report
    async function generateFullDebugReport() {
        recordLog('INFO', 'DEBUG_EXPORT', 'Generating full debug log report...');
        await flushLogsToStorage();

        let bgLogs = [];
        try {
            if (extBrowser && extBrowser.runtime && typeof extBrowser.runtime.sendMessage === 'function' && !CONTEXT_NAME.startsWith('BACKGROUND')) {
                const bgRes = await extBrowser.runtime.sendMessage({ action: 'getWmdDebugLogs' }).catch(() => null);
                if (bgRes && Array.isArray(bgRes.logs)) {
                    bgLogs = bgRes.logs;
                }
            }
        } catch (_) {}

        let storedLogs = [];
        try {
            if (extBrowser && extBrowser.storage && extBrowser.storage.local) {
                const res = await extBrowser.storage.local.get(STORAGE_KEY);
                if (res && Array.isArray(res[STORAGE_KEY])) {
                    storedLogs = res[STORAGE_KEY];
                }
            }
        } catch (_) {}

        // Merge & deduplicate logs from storage, background memory, and current window memory
        const mergedMap = new Map();
        for (const item of [...storedLogs, ...bgLogs, ...memoryLogs]) {
            if (item && item.id) {
                mergedMap.set(item.id, item);
            } else if (item) {
                mergedMap.set(`${item.ts}-${item.ctx}-${item.msg}`, item);
            }
        }
        const allLogs = Array.from(mergedMap.values()).sort((a, b) => (a.epoch || 0) - (b.epoch || 0));

        const [specs, storageSnapshot] = await Promise.all([
            collectBrowserAndSystemSpecs(),
            collectStorageSnapshot()
        ]);

        const styleSheets = inspectStyleSheets();
        const domAndTheme = inspectComputedThemeAndLayout();
        const popupCutoffDiagnostics = inspectPopupCutoffDiagnostics('report-export');
        const resourceTimings = inspectResourceTimings();

        let activeTabInfo = null;
        try {
            if (extBrowser && extBrowser.tabs && typeof extBrowser.tabs.query === 'function') {
                const tabs = await extBrowser.tabs.query({ active: true, currentWindow: true });
                if (tabs && tabs[0]) {
                    activeTabInfo = {
                        id: tabs[0].id,
                        status: tabs[0].status,
                        url: tabs[0].url ? tabs[0].url.slice(0, 300) : null,
                        title: tabs[0].title ? tabs[0].title.slice(0, 150) : null,
                        incognito: Boolean(tabs[0].incognito),
                        mutedInfo: tabs[0].mutedInfo || null
                    };
                }
            }
        } catch (_) {}

        const lines = [];
        const pushKv = (key, val) => {
            const formattedVal = (val === undefined || val === null || val === '')
                ? 'n/a'
                : (typeof val === 'object' ? JSON.stringify(val) : String(val));
            lines.push(`  ${String(key).padEnd(28, ' ')} : ${formattedVal}`);
        };

        lines.push('WEBSITE MEDIA DOWNLOADER DIAGNOSTIC REPORT');
        lines.push(`Report Timestamp             : ${new Date().toISOString()}`);
        lines.push(`Extension                    : ${specs.extension.name || 'Website Media Downloader'} v${specs.extension.version || '?'} (${specs.extension.edition || 'Unknown'} Edition, MV${specs.extension.manifestVersion || '?'})`);
        lines.push(`Extension ID / Background    : ${specs.extension.id || 'n/a'} (${specs.extension.backgroundType || 'n/a'})`);
        lines.push(`Report Context / Session     : ${CONTEXT_NAME} (${SESSION_ID})`);
        lines.push(`Recorded Log Entries         : ${allLogs.length}`);
        lines.push('');

        lines.push('[SYSTEM & BROWSER ENVIRONMENT]');
        pushKv('User-Agent', specs.browser.userAgent);
        if (specs.userAgentData) {
            const brands = Array.isArray(specs.userAgentData.brands)
                ? specs.userAgentData.brands.map(b => `${b.brand} ${b.version}`).join(', ')
                : null;
            const fullVer = Array.isArray(specs.userAgentData.fullVersionList)
                ? specs.userAgentData.fullVersionList.map(b => `${b.brand} ${b.version}`).join(', ')
                : null;
            pushKv('UA Client Hints Brands', fullVer || brands);
            pushKv('UA Platform / Version', `${specs.userAgentData.platform || 'n/a'} ${specs.userAgentData.platformVersion || ''} (mobile=${Boolean(specs.userAgentData.mobile)}, arch=${specs.userAgentData.architecture || 'n/a'}, ${specs.userAgentData.bitness || '?'}bit, model=${specs.userAgentData.model || 'n/a'})`.trim());
        }
        if (specs.platformInfo) {
            pushKv('Runtime Platform Info', `os=${specs.platformInfo.os || 'n/a'}, arch=${specs.platformInfo.arch || 'n/a'}, nacl_arch=${specs.platformInfo.nacl_arch || 'n/a'}`);
        }
        pushKv('Navigator Platform / Vendor', `${specs.browser.platform || 'n/a'} / ${specs.browser.vendor || 'n/a'}`);
        pushKv('Locale / Languages', `${specs.browser.uiLocale || specs.browser.language || 'n/a'} (${(specs.browser.languages || []).join(', ')})`);
        pushKv('Timezone', `${specs.browser.timeZone || 'n/a'} (UTC offset ${specs.browser.timeZoneOffsetMinutes}m)`);
        pushKv('CPU Cores / Device Memory', `${specs.hardwareAndDevice.hardwareConcurrency ?? 'n/a'} threads / ${specs.hardwareAndDevice.deviceMemoryGB ? specs.hardwareAndDevice.deviceMemoryGB + ' GB' : 'n/a'}`);
        pushKv('Max Touch Points', specs.hardwareAndDevice.maxTouchPoints);
        if (specs.hardwareAndDevice.jsHeapMemory) {
            const hm = specs.hardwareAndDevice.jsHeapMemory;
            pushKv('JS Heap Memory', `used=${Math.round((hm.usedJSHeapSizeBytes || 0) / 1048576)}MB, total=${Math.round((hm.totalJSHeapSizeBytes || 0) / 1048576)}MB, limit=${Math.round((hm.jsHeapSizeLimitBytes || 0) / 1048576)}MB`);
        }
        if (specs.graphicsWebGL) {
            pushKv('WebGL Renderer', `${specs.graphicsWebGL.unmaskedRenderer || specs.graphicsWebGL.renderer || 'n/a'} (${specs.graphicsWebGL.unmaskedVendor || specs.graphicsWebGL.vendor || 'n/a'})`);
        }
        if (specs.networkInfo) {
            pushKv('Network Connection', `type=${specs.networkInfo.effectiveType || 'n/a'}, downlink=${specs.networkInfo.downlinkMbps ?? 'n/a'}Mbps, rtt=${specs.networkInfo.rttMs ?? 'n/a'}ms, saveData=${specs.networkInfo.saveData}`);
        }
        if (specs.storageQuota) {
            pushKv('Browser Storage Quota', `used=${Math.round((specs.storageQuota.usageBytes || 0) / 1048576)}MB / quota=${Math.round((specs.storageQuota.quotaBytes || 0) / 1048576)}MB (${specs.storageQuota.usagePercent ?? 0}%)`);
        }
        pushKv('Media Capabilities', specs.mediaCapabilities);
        pushKv('Extension Permissions', (specs.extension.permissions || []).join(', '));
        lines.push('');

        lines.push('[SCREEN, VIEWPORT & POPUP CUTOFF DIAGNOSTICS]');
        if (specs.screenAndViewport) {
            const sv = specs.screenAndViewport;
            pushKv('Screen Resolution', `${sv.screenWidth}x${sv.screenHeight} (avail: ${sv.availWidth}x${sv.availHeight}, depth: ${sv.colorDepth}bit, orientation: ${sv.orientation || 'n/a'})`);
            pushKv('Window Dimensions', `inner: ${sv.windowInnerWidth}x${sv.windowInnerHeight}, outer: ${sv.windowOuterWidth}x${sv.windowOuterHeight}, DPR: ${sv.devicePixelRatio}`);
            pushKv('Color Scheme / Motion', `dark=${sv.prefersColorSchemeDark}, reducedMotion=${sv.prefersReducedMotion}`);
        }
        if (popupCutoffDiagnostics) {
            const pcd = popupCutoffDiagnostics;
            pushKv('Cutoff Status', pcd.cutoffDetected ? `WARNING - ${pcd.cutoffWarnings.join(' | ')}` : 'OK (No cutoff or overflow detected)');
            pushKv('Mode Flags', `is-popup=${pcd.modeFlags.isPopupClass}, is-mobile=${pcd.modeFlags.isMobileClass}, is-tab=${pcd.modeFlags.isTabClass}`);
            pushKv('CSS Zoom State', `computed=${pcd.zoom.computedZoom} (factor=${pcd.zoom.zoomFactor}, inline=${pcd.zoom.inlineStyleZoom || 'none'})`);
            pushKv('Visual Viewport', pcd.dimensions.visualViewport);
            pushKv('HTML Dimensions', `client=${pcd.dimensions.htmlClient.width}x${pcd.dimensions.htmlClient.height}, scroll=${pcd.dimensions.htmlScroll.width}x${pcd.dimensions.htmlScroll.height}, offset=${pcd.dimensions.htmlOffset.width}x${pcd.dimensions.htmlOffset.height}, rect=${JSON.stringify(pcd.dimensions.htmlBoundingRect)}`);
            pushKv('Body Dimensions', `client=${pcd.dimensions.bodyClient ? pcd.dimensions.bodyClient.width + 'x' + pcd.dimensions.bodyClient.height : 'n/a'}, scroll=${pcd.dimensions.bodyScroll ? pcd.dimensions.bodyScroll.width + 'x' + pcd.dimensions.bodyScroll.height : 'n/a'}, rect=${JSON.stringify(pcd.dimensions.bodyBoundingRect)}`);
            pushKv('Expected Popup Size', `base=${pcd.dimensions.expectedPopupBase.width}x${pcd.dimensions.expectedPopupBase.height}, zoomScaled=${pcd.dimensions.expectedPopupZoomScaled.width}x${pcd.dimensions.expectedPopupZoomScaled.height}`);
            pushKv('Overflow CSS', pcd.overflowState);
            if (pcd.clippedElements && pcd.clippedElements.length > 0) {
                pushKv('Clipped Elements', pcd.clippedElements);
            }
        }
        if (resizeTimeline.length > 0) {
            lines.push('  Viewport & Resize Timeline :');
            for (const rt of resizeTimeline) {
                lines.push(`    +${String(rt.relMs).padEnd(8, ' ')}ms [${rt.phase}] inner=${rt.inner} outer=${rt.outer} vv=${rt.visualVp || 'n/a'} htmlClient=${rt.htmlClient} htmlScroll=${rt.htmlScroll} htmlRect=${rt.htmlRect} zoom=${rt.zoom} dpr=${rt.dpr} classes="${rt.classes}"${rt.cutoffDetected ? ' [CUTOFF: ' + rt.warnings.join('; ') + ']' : ''}`);
            }
        }
        lines.push('');

        lines.push('[CSS STYLESHEETS, COMPUTED THEME & DOM LAYOUT]');
        if (domAndTheme) {
            pushKv('Document State', `readyState=${domAndTheme.readyState}, compatMode=${domAndTheme.compatMode}, visibility=${domAndTheme.visibilityState}`);
            pushKv('HTML Classes & Style', `classes="${(domAndTheme.htmlClasses || []).join(' ')}" | style="${domAndTheme.htmlInlineStyle}"`);
            pushKv('Body Classes & Style', `classes="${(domAndTheme.bodyClasses || []).join(' ')}" | style="${domAndTheme.bodyInlineStyle}"`);
            pushKv('HTML Computed Style', domAndTheme.htmlComputed);
            pushKv('Body Computed Style', domAndTheme.bodyComputed);
            pushKv('MDUI Theme Variables', domAndTheme.cssVariables);
            pushKv('MDUI Custom Elements', domAndTheme.customElementsRegistered);
            if (domAndTheme.keyElements) {
                lines.push('  Key DOM Containers         :');
                for (const [sel, info] of Object.entries(domAndTheme.keyElements)) {
                    lines.push(`    ${sel.padEnd(22, ' ')} : size=${info.width}x${info.height}, display=${info.display}, visibility=${info.visibility}, opacity=${info.opacity}, children=${info.childCount}, classes="${(info.classes || []).join(' ')}"`);
                }
            }
        }
        lines.push('  Loaded Stylesheets         :');
        if (styleSheets.length === 0) {
            lines.push('    (none)');
        } else {
            for (const s of styleSheets) {
                lines.push(`    [${s.index}] ${s.href} (tag=${s.ownerTag}, status=${s.status}, rules=${s.rulesCount ?? 'n/a'}, disabled=${s.disabled}, media=${s.media})`);
            }
        }
        lines.push('');

        lines.push('[ACTIVE TAB & EXTENSION SETTINGS]');
        pushKv('Active Browser Tab', activeTabInfo);
        pushKv('Storage Summary', storageSnapshot.storageSummary);
        lines.push('  Configuration Values       :');
        for (const [k, v] of Object.entries(storageSnapshot.settings || {}).sort(([a], [b]) => a.localeCompare(b))) {
            lines.push(`    ${k.padEnd(32, ' ')} : ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
        }
        lines.push('');

        lines.push('[RESOURCE PERFORMANCE TIMINGS]');
        if (resourceTimings.length === 0) {
            lines.push('  (No resource timing entries available)');
        } else {
            for (const r of resourceTimings) {
                lines.push(`  +${String(r.startTimeMs).padEnd(8, ' ')}ms (${String(r.durationMs).padStart(6, ' ')}ms) [${String(r.initiatorType).padEnd(6, ' ')}] size=${r.decodedBodySize ?? 'n/a'}B status=${r.responseStatus ?? 'n/a'} ${r.name}`);
            }
        }
        lines.push('');

        lines.push('[CHRONOLOGICAL EVENT & CONSOLE TRACE]');
        if (allLogs.length === 0) {
            lines.push('  (No log entries recorded)');
        } else {
            for (const entry of allLogs) {
                const rel = typeof entry.relMs === 'number' ? `+${entry.relMs.toFixed(2)}ms` : '';
                lines.push(`${entry.ts} ${rel.padStart(11, ' ')} [${entry.ctx.padEnd(16, ' ')}] [${entry.lvl.padEnd(5, ' ')}] [${entry.cat.padEnd(20, ' ')}] ${entry.msg}`);
            }
        }

        return {
            text: lines.join('\n'),
            entryCount: allLogs.length,
            specs
        };
    }

    async function clearAllDebugLogs() {
        memoryLogs.length = 0;
        pendingStorageLogs.length = 0;
        if (extBrowser && extBrowser.storage && extBrowser.storage.local) {
            await extBrowser.storage.local.remove(STORAGE_KEY).catch(() => {});
        }
        if (extBrowser && extBrowser.runtime && typeof extBrowser.runtime.sendMessage === 'function' && !CONTEXT_NAME.startsWith('BACKGROUND')) {
            await extBrowser.runtime.sendMessage({ action: 'clearWmdDebugLogs' }).catch(() => {});
        }
        recordLog('INFO', 'DEBUG_LOG', 'Debug logs cleared by user');
    }

    async function getDebugLogStats() {
        await flushLogsToStorage();
        let storedCount = 0;
        let byteSize = 0;
        try {
            if (extBrowser && extBrowser.storage && extBrowser.storage.local) {
                const res = await extBrowser.storage.local.get(STORAGE_KEY);
                const arr = (res && Array.isArray(res[STORAGE_KEY])) ? res[STORAGE_KEY] : [];
                storedCount = Math.max(arr.length, memoryLogs.length);
                byteSize = new Blob([JSON.stringify(arr)]).size;
            } else {
                storedCount = memoryLogs.length;
            }
        } catch (_) {
            storedCount = memoryLogs.length;
        }
        return { count: storedCount, bytes: byteSize };
    }

    // Listen for runtime messages in Background context so Popup can fetch/clear in-memory background logs
    if (extBrowser && extBrowser.runtime && extBrowser.runtime.onMessage && CONTEXT_NAME.startsWith('BACKGROUND')) {
        try {
            extBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (!message || typeof message !== 'object') return false;
                if (message.action === 'getWmdDebugLogs') {
                    flushLogsToStorage().finally(() => {
                        sendResponse({ logs: memoryLogs.slice(-500) });
                    });
                    return true;
                }
                if (message.action === 'clearWmdDebugLogs') {
                    memoryLogs.length = 0;
                    pendingStorageLogs.length = 0;
                    sendResponse({ cleared: true });
                    return false;
                }
                return false;
            });
        } catch (_) {}
    }

    globalScope.WMDDebugLogger = {
        log: (category, message, details) => recordLog('INFO', category, message, details),
        warn: (category, message, details) => recordLog('WARN', category, message, details),
        error: (category, message, details) => recordLog('ERROR', category, message, details),
        debug: (category, message, details) => recordLog('DEBUG', category, message, details),
        flush: flushLogsToStorage,
        clear: clearAllDebugLogs,
        getStats: getDebugLogStats,
        collectSpecs: collectBrowserAndSystemSpecs,
        generateReport: generateFullDebugReport
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : window));
