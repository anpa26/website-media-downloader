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



const pendingStreamVariants = new Map();
const streamVariantQueue = [];
let runningStreamVariants = 0;
function loadStreamVariants(url, isMPD) {
  const cache = isMPD ? mpdVariantsCache : m3u8VariantsCache;
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (pendingStreamVariants.has(url)) return pendingStreamVariants.get(url);
  const result = new Promise(resolve => {
    streamVariantQueue.push(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        resolve(await (isMPD ? getMPDVariants(url, controller.signal) : getM3U8Variants(url, controller.signal)));
      } catch (_) { resolve([]); }
      finally {
        clearTimeout(timeout);
        pendingStreamVariants.delete(url);
        runningStreamVariants--;
        drainStreamVariantQueue();
      }
    });
  });
  pendingStreamVariants.set(url, result);
  drainStreamVariantQueue();
  return result;
}
function drainStreamVariantQueue() {
  while (runningStreamVariants < 4 && streamVariantQueue.length) {
    runningStreamVariants++;
    streamVariantQueue.shift()();
  }
}

const m3u8VariantsCache = new Map();
function simpenCacheVarian(cache, url, nilai) {
  if (cache.size >= 200) {
    const kunciLawas = cache.keys().next().value;
    if (kunciLawas !== undefined) cache.delete(kunciLawas);
  }
  cache.set(url, nilai);
}

async function getM3U8Variants(url, signal) {
    if (m3u8VariantsCache.has(url)) {
        return m3u8VariantsCache.get(url);
    }
    try {
        const response = await spoofedFetch(url, { signal });
        if (!response.ok) return [];
        const text = await response.text();
        if (!text.includes("#EXT-X-STREAM-INF")) {
            simpenCacheVarian(m3u8VariantsCache, url, []);
            return [];
        }

        const parsed = globalThis.mediaCompute?.run
            ? await globalThis.mediaCompute.run('manifest-parse', { text, kind: 'm3u8' })
            : { lines: text.split("\n") };
        const lines = parsed.lines;
        const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
        const variants = [];

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
                const resolution = resMatch ? resMatch[1] : "unknown";
                const uri = lines[i + 1];
                if (uri) {
                    variants.push({
                        bandwidth,
                        resolution,
                        uri: uri.trim().startsWith("http") ? uri.trim() : baseUrl + uri.trim()
                    });
                }
            }
        }
        simpenCacheVarian(m3u8VariantsCache, url, variants);
        return variants;
    } catch (e) {
        console.warn("Failed to parse variants for", url, e);
        simpenCacheVarian(m3u8VariantsCache, url, []);
        return [];
    }
}

const mpdVariantsCache = new Map();

async function getMPDVariants(url, signal) {
    if (mpdVariantsCache.has(url)) {
        return mpdVariantsCache.get(url);
    }
    try {
        const response = await spoofedFetch(url, { signal });
        if (!response.ok) return [];
        const text = await response.text();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "application/xml");
        const NS = xmlDoc.documentElement.namespaceURI || "urn:mpeg:dash:schema:mpd:2011";

        const periodList = xmlDoc.getElementsByTagNameNS(NS, "Period");
        if (!periodList || periodList.length === 0) {
            simpenCacheVarian(mpdVariantsCache, url, []);
            return [];
        }
        const period = periodList[0];
        const allSets = Array.from(period.getElementsByTagNameNS(NS, "AdaptationSet"));
        const videoSet = allSets.find(asNode => {
            const mimeType = asNode.getAttribute("mimeType")?.toLowerCase() || "";
            const contentType = asNode.getAttribute("contentType")?.toLowerCase() || "";
            if (mimeType.startsWith("video/") || contentType === "video") return true;
            const reps = asNode.getElementsByTagNameNS(NS, "Representation");
            for (let i = 0; i < reps.length; i++) {
                const rm = reps[i].getAttribute("mimeType")?.toLowerCase() || "";
                if (rm.startsWith("video/")) return true;
            }
            return false;
        });

        if (!videoSet) {
            simpenCacheVarian(mpdVariantsCache, url, []);
            return [];
        }

        const repNodes = Array.from(videoSet.getElementsByTagNameNS(NS, "Representation"));
        const variants = [];
        repNodes.forEach(rNode => {
            const id = rNode.getAttribute("id");
            const bandwidth = parseInt(rNode.getAttribute("bandwidth") || "0", 10);
            const width = parseInt(rNode.getAttribute("width") || "0", 10);
            const height = parseInt(rNode.getAttribute("height") || "0", 10);
            if (width && height) {
                variants.push({
                    bandwidth,
                    resolution: `${width}x${height}`,
                    id: id
                });
            }
        });

        simpenCacheVarian(mpdVariantsCache, url, variants);
        return variants;
    } catch (e) {
        console.warn("Failed to parse MPD variants for", url, e);
        simpenCacheVarian(mpdVariantsCache, url, []);
        return [];
    }
}
