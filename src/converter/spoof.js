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



const _spoofedHeadersCache = new Map();
const SPOOFED_HEADERS_CACHE_TTL_MS = 30000;
const SPOOFED_HEADERS_CACHE_MAX_SIZE = 500;

async function getCachedSpoofedHeaders(url) {
  const now = Date.now();
  const cached = _spoofedHeadersCache.get(url);
  if (cached && (now - cached.ts) < SPOOFED_HEADERS_CACHE_TTL_MS) {
    return cached.headers;
  }
  const headers = await chrome.runtime.sendMessage({ action: 'getSpoofedHeaders', url: url });
  if (_spoofedHeadersCache.size >= SPOOFED_HEADERS_CACHE_MAX_SIZE) {
    const firstKey = _spoofedHeadersCache.keys().next().value;
    if (firstKey !== undefined) _spoofedHeadersCache.delete(firstKey);
  }
  _spoofedHeadersCache.set(url, { headers: headers || null, ts: now });
  return headers;
}

async function spoofedFetch(url, options = {}) {
  try {
    const existingHeaders = options.headers || {};
    const hasCustomHeaders = Boolean(
      existingHeaders['Referer'] || existingHeaders['referer'] ||
      existingHeaders['Cookie'] || existingHeaders['cookie'] ||
      existingHeaders['Origin'] || existingHeaders['origin']
    );
    const headers = hasCustomHeaders ? null : await getCachedSpoofedHeaders(url);
    if (headers) {
      options.headers = options.headers || {};
      if (headers.cookie) options.headers['Cookie'] = headers.cookie;
      if (headers.referer) {
        options.headers['Referer'] = headers.referer;
        options.referrer = headers.referer;
      }
      if (headers.origin) options.headers['Origin'] = headers.origin;
      options.credentials = 'include';
    }
  } catch (e) {
    console.warn("Failed to get spoofed headers, falling back to normal fetch:", e);
  }
  return fetch(url, options);
}
