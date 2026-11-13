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



function waitForSegmentRetry(delay, checkCancel) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    if (!checkCancel) return;
    const interval = setInterval(() => {
      if (!checkCancel()) return;
      clearTimeout(timer);
      clearInterval(interval);
      reject(new Error("Cancelled"));
    }, Math.min(250, delay));
    setTimeout(() => clearInterval(interval), delay + 10);
  });
}

let segmentRetryNotBefore = 0;

function getSegmentRetryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay) && delay > 0) return Math.min(60000, delay);
  }
  return Math.min(15000, 750 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 500);
}

async function waitForStreamCooldown(checkCancel) {
  const delay = segmentRetryNotBefore - Date.now();
  if (delay > 0) await waitForSegmentRetry(delay, checkCancel);
}

async function waitForSegmentPause(pauseKey, checkCancel) {
  while (pauseKey && globalThis.activePauses?.has(pauseKey)) {
    if (checkCancel?.()) throw new Error("Cancelled");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function fetchSegmentWithRetry(url, options, checkCancel, pauseKey = null, maxAttempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (checkCancel?.()) throw new Error("Cancelled");
    try {
      await waitForSegmentPause(pauseKey, checkCancel);
      await waitForSegmentPause(pauseKey, checkCancel);
      await waitForStreamCooldown(checkCancel);
      const response = await fetchWithCache(url, options);
      if (response.ok) return response;
      const error = new Error(`HTTP ${response.status} while downloading segment`);
      error.status = response.status;
      error.response = response;
      throw error;
    } catch (error) {
      if (error?.message === "Cancelled" || error?.name === "AbortError" || checkCancel?.()) {
        throw new Error("Cancelled");
      }
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
      if (!retryable || attempt === maxAttempts) break;
      const delay = getSegmentRetryDelay(error.response, attempt);
      segmentRetryNotBefore = Math.max(segmentRetryNotBefore, Date.now() + delay);
      console.warn(`Segment retry ${attempt}/${maxAttempts - 1} in ${delay}ms: ${url}`, error);
      await waitForSegmentRetry(delay, checkCancel);
    }
  }
  throw lastError || new Error(`Failed to download segment: ${url}`);
}

async function fetchSegmentBufferWithRetry(url, options, checkCancel, pauseKey = null, maxAttempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (checkCancel?.()) throw new Error("Cancelled");
    try {
      await waitForStreamCooldown(checkCancel);
      const response = await fetchWithCache(url, options);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} while downloading segment`);
        error.status = response.status;
        error.response = response;
        throw error;
      }
      if (!response.body) return await response.arrayBuffer();
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        await waitForSegmentPause(pauseKey, checkCancel);
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); total += value.byteLength;
      }
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return result.buffer;
    } catch (error) {
      if (error?.message === "Cancelled" || error?.name === "AbortError" || checkCancel?.()) throw new Error("Cancelled");
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
      if (!retryable || attempt === maxAttempts) break;
      const delay = getSegmentRetryDelay(error.response, attempt);
      segmentRetryNotBefore = Math.max(segmentRetryNotBefore, Date.now() + delay);
      console.warn(`Segment body retry ${attempt}/${maxAttempts - 1} in ${delay}ms: ${url}`, error);
      await waitForSegmentRetry(delay, checkCancel);
    }
  }
  throw lastError || new Error(`Failed to download segment: ${url}`);
}
