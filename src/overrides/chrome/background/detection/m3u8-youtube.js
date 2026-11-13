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

const m3u8VariantsCacheBg = new Map();

async function getM3U8VariantsBg(url) {
    if (m3u8VariantsCacheBg.has(url)) {
        return m3u8VariantsCacheBg.get(url);
    }
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const text = await response.text();
        if (!text.includes("#EXT-X-STREAM-INF")) {
            m3u8VariantsCacheBg.set(url, []);
            return [];
        }

        const lines = text.split("\n");
        const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
        const variants = [];

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
                const resolution = resMatch ? resMatch[1] : "unknown";
                let uri = lines[i + 1];
                if (uri) {
                    uri = uri.trim();
                    variants.push({
                        bandwidth,
                        resolution,
                        uri: uri.startsWith("http") ? uri : baseUrl + uri
                    });
                }
            }
        }
        m3u8VariantsCacheBg.set(url, variants);
        return variants;
    } catch (e) {
        console.warn("Failed to parse variants for", url, e);
        m3u8VariantsCacheBg.set(url, []);
        return [];
    }
}

let clientZipLoadPromise = null;
async function ensureClientZipLoaded() {
    if (typeof downloadZip !== 'undefined') return;
    if (!clientZipLoadPromise) {
        clientZipLoadPromise = Promise.resolve().then(() => {
            importScripts('libraries/client-zip.js');
            if (typeof downloadZip === 'undefined') throw new Error('client-zip.js did not expose downloadZip');
        }).catch(error => {
            clientZipLoadPromise = null;
            throw error;
        });
    }
    return clientZipLoadPromise;
}
