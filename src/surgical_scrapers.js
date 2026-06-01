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

(function() {
    const SurgicalScrapers = {
        instagram: () => {
            const urls = new Set();
            document.querySelectorAll('video').forEach(v => {
                if (v.src && !v.src.startsWith('blob:')) urls.add(v.src);
            });

            document.querySelectorAll('video').forEach(v => {
                try {
                    const reactKey = Object.keys(v).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
                    if (reactKey && v[reactKey]) {
                        const findUrls = (obj, depth = 0) => {
                            if (depth > 10 || !obj || typeof obj !== 'object') return;
                            for (const key in obj) {
                                if (typeof obj[key] === 'string' && (obj[key].includes('.mp4') || obj[key].includes('.cdninstagram.com'))) {
                                    if (obj[key].startsWith('http')) urls.add(obj[key]);
                                } else if (typeof obj[key] === 'object') {
                                    findUrls(obj[key], depth + 1);
                                }
                            }
                        };
                        findUrls(v[reactKey]);
                    }
                } catch (e) {}
            });

            document.querySelectorAll('script').forEach(s => {
                const content = s.textContent;
                if (content.includes('video_versions')) {
                    try {
                        const regex = /\{[^{}]*"video_versions"[^{}]*\[[^{}\]]*\][^{}]*\}/g;
                        const matches = content.match(regex);
                        if (matches) {
                            matches.forEach(m => {
                                try {
                                    const urlMatch = m.match(/"url":\s*"([^"]+)"/g);
                                    if (urlMatch) {
                                        urlMatch.forEach(um => {
                                            const url = um.match(/"url":\s*"([^"]+)"/)[1];
                                            if (url && (url.includes('.mp4') || url.includes('.cdninstagram.com'))) {
                                                urls.add(url.replace(/\\u0026/g, '&'));
                                            }
                                        });
                                    }
                                } catch(e) {}
                            });
                        }
                    } catch(e) {}
                }
            });

            return Array.from(urls);
        },

        tiktok: () => {
            const urls = new Set();
            document.querySelectorAll('video').forEach(v => {
                if (v.src && !v.src.startsWith('blob:')) urls.add(v.src);
                const source = v.querySelector('source');
                if (source && source.src && !source.src.startsWith('blob:')) urls.add(source.src);
            });

            const sigi = document.getElementById('SIGI_STATE');
            if (sigi) {
                try {
                    const data = JSON.parse(sigi.textContent);
                    if (data.ItemModule) {
                        Object.values(data.ItemModule).forEach(item => {
                            if (item.video) {
                                if (item.video.downloadAddr) urls.add(item.video.downloadAddr);
                                if (item.video.playAddr) urls.add(item.video.playAddr);
                            }
                        });
                    }
                } catch (e) {}
            }

            const renderData = document.getElementById('RENDER_DATA');
            if (renderData) {
                try {
                    const data = JSON.parse(decodeURIComponent(renderData.textContent));
                    const findVideo = (obj, depth = 0) => {
                        if (depth > 15 || !obj || typeof obj !== 'object') return;
                        if (obj.playAddr || obj.downloadAddr) {
                            if (obj.playAddr) urls.add(obj.playAddr);
                            if (obj.downloadAddr) urls.add(obj.downloadAddr);
                        }
                        for (const key in obj) {
                            if (typeof obj[key] === 'object') findVideo(obj[key], depth + 1);
                        }
                    };
                    findVideo(data);
                } catch (e) {}
            }

            return Array.from(urls);
        },

        twitter: () => {
            const urls = new Set();
            document.querySelectorAll('video').forEach(v => {
                if (v.src && !v.src.startsWith('blob:')) urls.add(v.src);
            });

            document.querySelectorAll('script').forEach(s => {
                const hlsMatches = s.textContent.match(/https?:\/\/[^"']+\.m3u8/g);
                if (hlsMatches) {
                    hlsMatches.forEach(url => urls.add(url));
                }
            });

            return Array.from(urls);
        }
    };

    window.mdu_run_surgical_scrapers = () => {
        const host = window.location.hostname;
        let detectedUrls = [];

        if (host.includes('instagram.com')) {
            detectedUrls = SurgicalScrapers.instagram();
        } else if (host.includes('tiktok.com')) {
            detectedUrls = SurgicalScrapers.tiktok();
        } else if (host.includes('twitter.com') || host.includes('x.com')) {
            detectedUrls = SurgicalScrapers.twitter();
        }

        return detectedUrls;
    };
})();