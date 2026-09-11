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

var detectionExclusions = (() => {
    const api = typeof browser === 'undefined' ? chrome : browser;
    let names = [];
    let domains = [];
    let ignoreExcluded = true;
    const split = value => typeof value === 'string'
        ? value.split(/[\n,;]+/).map(entry => entry.trim().toLowerCase()).filter(Boolean) : [];
    function configure(settings) {
        names = split(settings['skip-detection-names']);
        domains = split(settings['skip-detection-domains']).map(entry => {
            try {
                return new URL(entry.includes('://') ? entry : 'https://' + entry.replace(/^\*\./, '')).hostname.replace(/\.$/, '');
            } catch (_) { return ''; }
        }).filter(Boolean);
    }
    const isEnabled = value => value !== '0' && value !== false && value !== 0;
    const ready = api.storage.local.get(['skip-detection-names', 'skip-detection-domains', 'ignore-excluded-media']).then(settings => {
        configure(settings);
        ignoreExcluded = isEnabled(settings['ignore-excluded-media']);
    });
    api.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes['ignore-excluded-media']) ignoreExcluded = isEnabled(changes['ignore-excluded-media'].newValue);
        if (changes['skip-detection-names']) names = split(changes['skip-detection-names'].newValue);
        if (changes['skip-detection-domains']) {
            configure({ 'skip-detection-names': names.join('\n'), 'skip-detection-domains': changes['skip-detection-domains'].newValue });
        }
    });
    function matches(details) {
        const urls = [details.url, details.pageUrl, details.documentUrl, details.originUrl, details.initiator];
        const values = [...urls, details.pageTitle, details.title, details.filename,
            ...(details.responseHeaders || []).filter(h => h.name?.toLowerCase() === 'content-disposition').map(h => h.value)];
        if (values.some(value => {
            let text = String(value || '').toLowerCase();
            try { text = decodeURIComponent(text).toLowerCase(); } catch (_) {}
            return names.some(name => text.includes(name));
        })) return true;
        return urls.some(value => {
            try {
                const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
                return domains.some(domain => host === domain || host.endsWith('.' + domain));
            } catch (_) { return false; }
        });
    }
    function matchesDetection(details) {
        return ignoreExcluded && matches(details);
    }
    async function shouldSkip(details, notification = false) {
        await ready;
        if (!notification && !ignoreExcluded) return false;
        if (!names.length && !domains.length) return false;
        if (matches(details)) return true;
        if (details.tabId >= 0) {
            try {
                const tab = await api.tabs.get(details.tabId);
                return matches({ ...details, pageUrl: tab.url, pageTitle: tab.title });
            } catch (_) {}
        }
        return false;
    }
    return { ready, matches, matchesDetection, shouldSkip };
})();
