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



async function downloadMPDOffline(mpdUrl, headers, downloadMethod, loadingBar, request, customFilename = null, audioOnly = false, selectedQuality = null) {
  await ensureClientZipLoaded();
  const throwIfCancelled = () => {
    if (window.activeCancellations && window.activeCancellations.has(mpdUrl)) throw new Error("Cancelled");
  };
  throwIfCancelled();
  await ensureClientZipLoaded();

  function sanitizeZipPath(originalPath) {
    if (!originalPath || typeof originalPath !== "string") return originalPath || "";
    if (/^https?:\/\//i.test(originalPath) || /^\/\//.test(originalPath)) {
      try {
        const parsed = new URL(originalPath, "http://example.invalid");
        const p = parsed.pathname.replace(/^\//, "");
        return p || parsed.hostname;
      } catch (e) {
        return originalPath.replace(/^https?:\/\//i, "").replace(/[:?#]/g, "_");
      }
    }
    const parts = originalPath.split("/");
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (seg === "" || seg === ".") continue;
      else if (seg === "..") {
        if (out.length > 0) out.pop();
        else continue;
      } else out.push(seg);
    }
    if (out.length === 0) {
      const fallback = originalPath.split("/").filter(Boolean).slice(-1)[0] || "file";
      return fallback.replace(/[^a-zA-Z0-9._-]/g, "_");
    }
    return out.join("/");
  }

  const resp = await fetchWithCache(mpdUrl, {
    method: request.method,
    headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
    referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value || ""
  });
  throwIfCancelled();
  if (!resp.ok) throw new Error(browser.i18n.getMessage("mpdFetchError", [resp.status.toString()]));
  let mpdXmlText = await resp.text();

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(mpdXmlText, "application/xml");
  const NS = xmlDoc.documentElement.namespaceURI || "urn:mpeg:dash:schema:mpd:2011";

  const hasDRM = !!xmlDoc.getElementsByTagNameNS(NS, "ContentProtection").length;
  let drmAbort = false;
  if (hasDRM) {
    await mdui.confirm({
      headline: browser.i18n.getMessage("drmWarningTitle"),
      description: browser.i18n.getMessage("drmWarningDescription"),
      confirmText: browser.i18n.getMessage("drmWarningConntinueButton"),
      cancelText: browser.i18n.getMessage("drmWarningCancelButton"),
      onCancel: () => { drmAbort = true; },
    });
  }

        if (drmAbort) {
            throw new Error(browser.i18n.getMessage("drmAbortedError") || "Download aborted by user due to DRM protection.");
        }

  const periodList = xmlDoc.getElementsByTagNameNS(NS, "Period");
  if (!periodList || periodList.length === 0) throw new Error(browser.i18n.getMessage("mpdNoPeriodError"));
  const period = periodList[0];

  let baseURLNode = period.getElementsByTagNameNS(NS, "BaseURL")[0];
  let baseURLForZip = baseURLNode ? baseURLNode.textContent.trim() : "";
  if (baseURLForZip.match(/^https?:\/\//i)) {
    try {
      const u = new URL(baseURLForZip);
      baseURLForZip = u.pathname.replace(/^\//, "");
    } catch (e) { baseURLForZip = ""; }
  }
  if (baseURLForZip && !baseURLForZip.endsWith("/")) baseURLForZip += "/";

  const allSets = Array.from(period.getElementsByTagNameNS(NS, "AdaptationSet"));
  const adaptationSets = allSets.filter(asNode => {
    const mimeType = asNode.getAttribute("mimeType")?.toLowerCase() || "";
    const contentType = asNode.getAttribute("contentType")?.toLowerCase() || "";
    if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return true;
    if (contentType === "audio" || contentType === "video") return true;
    const reps = asNode.getElementsByTagNameNS(NS, "Representation");
    for (let i = 0; i < reps.length; i++) {
      const rm = reps[i].getAttribute("mimeType")?.toLowerCase() || "";
      if (rm.startsWith("audio/") || rm.startsWith("video/")) return true;
    }
    return false;
  });
  if (adaptationSets.length === 0) throw new Error(browser.i18n.getMessage("mpdNoMediaError"));

  const parsedAdaptations = adaptationSets.map(asNode => {
    const declaredType = asNode.getAttribute("contentType");
    let contentType;
    if (declaredType === "video" || declaredType === "audio") contentType = declaredType;
    else {
      const mimeType = asNode.getAttribute("mimeType")?.toLowerCase() || "";
      if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) contentType = mimeType.startsWith("video/") ? "video" : "audio";
      else {
        const reps = asNode.getElementsByTagNameNS(NS, "Representation");
        if (reps.length > 0) {
          const repMimeType = reps[0].getAttribute("mimeType")?.toLowerCase() || "";
          contentType = repMimeType.startsWith("video/") ? "video" : "audio";
        } else contentType = "video";
      }
    }

    const setSegTmplNode = asNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];

    let baseSegTmpl = null;
    if (setSegTmplNode) {
      baseSegTmpl = {
        media: setSegTmplNode.getAttribute("media"),
        initialization: setSegTmplNode.getAttribute("initialization"),
        duration: parseInt(setSegTmplNode.getAttribute("duration") || "0", 10),
        timescale: parseInt(setSegTmplNode.getAttribute("timescale") || "1", 10),
        startNumber: setSegTmplNode.getAttribute("startNumber") !== null ? parseInt(setSegTmplNode.getAttribute("startNumber"), 10) : 1,
      };
    }

    const repNodes = Array.from(asNode.getElementsByTagNameNS(NS, "Representation"));
    if (repNodes.length === 0) throw new Error("AdaptationSet has no Representation elements.");

    const representations = repNodes.map(rNode => {
      const id = rNode.getAttribute("id");
      const bandwidth = parseInt(rNode.getAttribute("bandwidth") || "0", 10);
      const width = parseInt(rNode.getAttribute("width") || "0", 10);
      const height = parseInt(rNode.getAttribute("height") || "0", 10);

      const repSegTmplNode = rNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
      if (repSegTmplNode || setSegTmplNode) {
        const tmplNode = repSegTmplNode || setSegTmplNode;
        const segTmpl = {
          media: tmplNode.getAttribute("media"),
          initialization: tmplNode.getAttribute("initialization"),
          duration: parseInt(tmplNode.getAttribute("duration") || (baseSegTmpl ? baseSegTmpl.duration.toString() : "0"), 10),
          timescale: parseInt(tmplNode.getAttribute("timescale") || (baseSegTmpl ? baseSegTmpl.timescale.toString() : "1"), 10),
          startNumber: tmplNode.getAttribute("startNumber") !== null ? parseInt(tmplNode.getAttribute("startNumber"), 10) : (baseSegTmpl ? baseSegTmpl.startNumber : 1),
        };
        return { id, bandwidth, width, height, type: "segmentTemplate", segmentTemplate: segTmpl };
      }

      const repSegBaseNode = rNode.getElementsByTagNameNS(NS, "SegmentBase")[0] || asNode.getElementsByTagNameNS(NS, "SegmentBase")[0];
      if (repSegBaseNode) {
        const initNode = repSegBaseNode.getElementsByTagNameNS(NS, "Initialization")[0];
        const initRange = initNode ? initNode.getAttribute("range") : null;
        const indexRange = repSegBaseNode.getAttribute("indexRange") || null;
        const repBaseURLNode = rNode.getElementsByTagNameNS(NS, "BaseURL")[0] || asNode.getElementsByTagNameNS(NS, "BaseURL")[0];
        const baseURLText = repBaseURLNode ? repBaseURLNode.textContent.trim() : null;
        return { id, bandwidth, width, height, type: "segmentBase", baseURL: baseURLText, initRange, indexRange };
      }

      const repSegListNode = rNode.getElementsByTagNameNS(NS, "SegmentList")[0] || asNode.getElementsByTagNameNS(NS, "SegmentList")[0];
      if (repSegListNode) {
        const initNode = repSegListNode.getElementsByTagNameNS(NS, "Initialization")[0];
        const initUrl = initNode?.getAttribute("sourceURL") || initNode?.textContent?.trim() || null;

        const segNodes = Array.from(repSegListNode.getElementsByTagNameNS(NS, "SegmentURL"));
        const segmentUrls = segNodes
          .map(n => n.getAttribute("media"))
          .filter(Boolean);

        if (!initUrl) {
          throw new Error("SegmentList is missing Initialization@sourceURL.");
        }
        if (segmentUrls.length === 0) {
          throw new Error("SegmentList has no SegmentURL entries.");
        }

        return {
          id,
          bandwidth,
          width,
          height,
          type: "segmentList",
          initializationUrl: initUrl,
          segmentUrls,
        };
      }

      throw new Error("AdaptationSet missing SegmentTemplate/SegmentBase. Downloading this MPD is not supported yet.");
    });

    return { contentType, representations, node: asNode };
  });

  const videoAdaptation = parsedAdaptations.find(a => a.contentType === "video");
  const audioAdaptation = parsedAdaptations.find(a => a.contentType === "audio");

  if (!videoAdaptation && !audioAdaptation) {
    throw new Error("MPD has no audio or video AdaptationSet.");
  }

  const chosenVideoRep = videoAdaptation && !audioOnly
    ? await selectMPDVideoRepresentation(videoAdaptation.representations, selectedQuality)
    : null;

  const chosenAudioRep = audioAdaptation
    ? await selectMPDAudioRepresentation(audioAdaptation.representations, selectedQuality)
    : null;

  if (audioOnly && !chosenAudioRep) {
    throw new Error(browser.i18n.getMessage("audioExtractionNotSupported") || "This MPD does not contain an audio track.");
  }

  const mpdBase = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);
  const mpdFilename = customFilename || getFileName(mpdUrl);
  const baseName = mpdFilename.replace(/\.mpd$/i, "");

  const isSegmentBaseOnly =
  (!!chosenVideoRep || !!chosenAudioRep) &&
  (!chosenVideoRep || chosenVideoRep.type === "segmentBase") &&
  (!chosenAudioRep || chosenAudioRep.type === "segmentBase");

  async function fetchWithProgress(url, { onStart, onChunk } = {}) {
    throwIfCancelled();
    const fetchOptions = {
      method: request.method,
      headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
      referrer: request.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value || ""
    };

    if (request.method !== 'GET' && request.requestBody) {
      if (request.requestBody.type === 'formData') {
        const formData = new FormData();
        for (const key in request.requestBody.data) {
          request.requestBody.data[key].forEach(val => formData.append(key, val));
        }
        fetchOptions.body = formData;
      } else if (request.requestBody.type === 'base64') {
        const bin = atob(request.requestBody.data);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        fetchOptions.body = u;
      }
    }

    const checkCancel = () => {
      try { throwIfCancelled(); return false; } catch (_) { return true; }
    };
    if (!onStart && !onChunk) {
      const buffer = await fetchSegmentBufferWithRetry(url, fetchOptions, checkCancel, mpdUrl);
      throwIfCancelled();
      return new Blob([buffer]);
    }

    const r = await fetchSegmentWithRetry(url, fetchOptions, checkCancel, mpdUrl);
    throwIfCancelled();
    if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);

    const contentLength = Number(r.headers.get("Content-Length")) || 0;
    if (onStart) onStart(contentLength);

    if (!r.body) {
      if (onChunk) onChunk(0, contentLength);
      return new Blob([]);
    }

    const reader = r.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        throwIfCancelled();
        await waitForSegmentPause(mpdUrl, checkCancel);
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new Blob([value]));
        received += value.byteLength;
        if (onChunk) onChunk(received, contentLength);
      }
    } catch (err) {
      try { reader.cancel(); } catch (e) { }
      if (err?.message === "Cancelled") throw err;
      throw new Error(`Error reading response stream: ${err?.message || err}`);
    }

    return new Blob(chunks);
  }

  if (isSegmentBaseOnly) {
    tampilnoNotif(browser.i18n.getMessage("splitDownloadWarningSnackbar"), { durasi: 10000 });
    const downloads = [];
    if (chosenVideoRep) downloads.push({ rep: chosenVideoRep, label: "video" });
    if (chosenAudioRep) downloads.push({ rep: chosenAudioRep, label: "audio" });

    loadingBar.value = 0;
    let downloadedBytes = 0;
    let sawUnknownLength = false;

    function addToMax(n) {
      if (!loadingBar._max) loadingBar._max = 0;
      loadingBar._max += n;
    }

    const settings = await browser.storage.local.get(['speed-boost', 'connections']);
    const isParallel = settings['speed-boost'] === '1';
    const concurrency = isParallel ? parseInt(settings['connections'] || '4', 10) : 1;
    const queue = new ParallelQueue(concurrency);

    const downloadDirectTask = async (d) => {
      const url = new URL(d.rep.baseURL, mpdBase).href;

      let candidate = baseName;
      if (!candidate || candidate === "") {
        candidate = d.label === "video" ? `${baseName}_video.mp4` : `${baseName}_audio.mp4`;
      } else {
        candidate += d.label === "video" ? "_video.mp4" : "_audio.mp3";
      }
      const filename = candidate;

      let lastReceivedForFile = 0;
      const blob = await fetchWithProgress(url, {
        onStart: (contentLength) => {
          if (contentLength && contentLength > 0) {
            addToMax(contentLength);
          } else {

            sawUnknownLength = true;
            loadingBar.setAttribute("indeterminate", "");
          }
        },
        onChunk: (received, contentLength) => {
          const delta = received - lastReceivedForFile;
          lastReceivedForFile = received;
          downloadedBytes += delta;

          const max = loadingBar._max || 0;
          updateProgressStatus(loadingBar, downloadedBytes, max);
        }
      });

      throwIfCancelled();
      let finalBlob = blob;
      let finalName = filename;
      if (audioOnly) {
        const mp3Enabled = (await browser.storage.local.get('audio-to-mp3'))['audio-to-mp3'] === '1';
        if (mp3Enabled) {
          const converted = await convertM4aToMp3Direct(blob, customFilename || (baseName + ".mp3"), loadingBar, throwIfCancelled);
          finalBlob = converted.blob;
          finalName = converted.filename;
        } else {
          finalName = (customFilename || baseName).replace(/\.[a-zA-Z0-9]+$/, '') + ".m4a";
        }
      }
      throwIfCancelled();
      await finalizeDownload(finalBlob, finalName, downloadMethod, loadingBar);
    };

    const directTasks = downloads.map(d => queue.add(() => downloadDirectTask(d)));
    await Promise.all(directTasks);

    const finalMax = loadingBar._max || downloadedBytes || 1;
    updateProgressStatus(loadingBar, downloadedBytes, finalMax);

    showDialog(browser.i18n.getMessage("splitAudioVideoDownloadCompleteDescription", [baseName, ".mp4"]), browser.i18n.getMessage("splitAudioVideoDownloadCompleteTitle"), { error: browser.i18n.getMessage("splitAudioVideoDownloadCompleteSuccess", [baseName]), url: mpdUrl, request: request, downloadMethod: downloadMethod });
    return;
  }

  const mpdToMp4Settings = await browser.storage.local.get(["gabung-stream", "mpd-to-mp4"]);
  const mpdToMp4Enabled = audioOnly || (mpdToMp4Settings["gabung-stream"] !== "0");

  tampilnoNotif(mpdToMp4Enabled
    ? browser.i18n.getMessage("mpdDownloadMergeExplainSnackbar")
    : browser.i18n.getMessage("mpdDownloadExplainSnackbar"), { durasi: 10000 });

  function substituteVars(path, rep, extra = {}) {
    return path
      .replace(/\$RepresentationID\$/g, rep.id)
      .replace(/\$Bandwidth\$/g, rep.bandwidth)
      .replace(/\$Number\$/g, extra.number !== undefined ? String(extra.number) : "$Number$")
      .replace(/\$Time\$/g, extra.time !== undefined ? String(extra.time) : "$Time$");
  }

  function buildSegmentUrlsForTemplate(rep) {
    const tmpl = rep.segmentTemplate;
    const baseUrl = mpdBase;
    const initPath = substituteVars(tmpl.initialization, rep, {});
    const initUrl = new URL(initPath, baseUrl).href;
    const initZipPath = sanitizeZipPath(initPath);

    let repNode = Array.from(xmlDoc.getElementsByTagNameNS(NS, "Representation")).find(r => r.getAttribute("id") === rep.id);
    let tmplNode = null;
    if (repNode) {
      tmplNode = repNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
      if (!tmplNode && repNode.parentElement) tmplNode = repNode.parentElement.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
    } else tmplNode = xmlDoc.getElementsByTagNameNS(NS, "SegmentTemplate")[0];

    let segmentStartTimes = null;
    const timelineNode = tmplNode ? tmplNode.getElementsByTagNameNS(NS, "SegmentTimeline")[0] : null;
    if (timelineNode) {
      const sElems = Array.from(timelineNode.getElementsByTagNameNS(NS, "S"));
      segmentStartTimes = [];
      let cursor = null;
      for (let i = 0; i < sElems.length; i++) {
        const s = sElems[i];
        const tAttr = s.getAttribute("t");
        const dAttr = s.getAttribute("d");
        const rAttr = s.getAttribute("r");
        if (!dAttr) throw new Error("SegmentTimeline S element missing 'd' attribute — cannot compute segments.");
        const d = parseInt(dAttr, 10);
        const r = rAttr !== null ? parseInt(rAttr, 10) : 0;
        if (tAttr !== null) cursor = parseInt(tAttr, 10);
        else if (cursor === null) cursor = 0;
        const repeatCount = r + 1;
        for (let k = 0; k < repeatCount; k++) {
          segmentStartTimes.push(cursor);
          cursor += d;
        }
      }
    }

    const usesTimeVar = tmpl.media && tmpl.media.indexOf("$Time$") !== -1;
    const mediaPaths = [];
    const mediaZipPaths = [];
    const segmentUrls = [];
    const firstIndex = tmpl.startNumber ?? 1;

    if (usesTimeVar) {
      if (!segmentStartTimes) {
        if (tmpl.duration && tmpl.duration > 0) {
          const segLen = tmpl.duration;
          const mpdRoot = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0];
          const totalDurationISO = mpdRoot.getAttribute("mediaPresentationDuration");
          const parseISODuration = d => {
            const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d);
            if (!m) return 0;
            const years = parseFloat(m[1] || "0");
            const months = parseFloat(m[2] || "0");
            const days = parseFloat(m[3] || "0");
            const hours = parseFloat(m[4] || "0");
            const minutes = parseFloat(m[5] || "0");
            const secs = parseFloat(m[6] || "0");
            return (years * 365 * 24 * 3600 + months * 30 * 24 * 3600 + days * 24 * 3600 + hours * 3600 + minutes * 60 + secs);
          };
          const totalSec = parseISODuration(totalDurationISO);
          const segLenSec = segLen / (tmpl.timescale || 1);
          const estimatedCount = Math.ceil(totalSec / segLenSec);

          segmentStartTimes = [];
          for (let i = 0; i < estimatedCount; i++) segmentStartTimes.push(i * segLen);
        } else {
          throw new Error(browser.i18n.getMessage("dashComputeSegmentsError") || "Cannot compute $Time$ segments: SegmentTimeline missing and no fixed duration provided.");
        }
      }

      for (let i = 0; i < segmentStartTimes.length; i++) {
        const t = segmentStartTimes[i];
        const mediaPath = substituteVars(tmpl.media, rep, { time: t, number: firstIndex + i });
        mediaPaths.push(mediaPath);
        mediaZipPaths.push(sanitizeZipPath(mediaPath));
        segmentUrls.push(new URL(mediaPath, baseUrl).href);
      }
    } else {

      if (segmentStartTimes && segmentStartTimes.length > 0) {
        for (let i = 0; i < segmentStartTimes.length; i++) {
          const number = (tmpl.startNumber ?? 1) + i;
          const mediaPath = substituteVars(tmpl.media, rep, { number });
          mediaPaths.push(mediaPath);
          mediaZipPaths.push(sanitizeZipPath(mediaPath));
          segmentUrls.push(new URL(mediaPath, baseUrl).href);
        }
      } else {

        const mpdRoot = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0];
        const totalDurationISO = mpdRoot.getAttribute("mediaPresentationDuration");
        const parseISODuration = d => {
          const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d);
          if (!m) return 0;
          const years = parseFloat(m[1] || "0");
          const months = parseFloat(m[2] || "0");
          const days = parseFloat(m[3] || "0");
          const hours = parseFloat(m[4] || "0");
          const minutes = parseFloat(m[5] || "0");
          const secs = parseFloat(m[6] || "0");
          return (years * 365 * 24 * 3600 + months * 30 * 24 * 3600 + days * 24 * 3600 + hours * 3600 + minutes * 60 + secs);
        };
        const totalSec = parseISODuration(totalDurationISO);

        const segLenSec = (tmpl.duration || 0) / (tmpl.timescale || 1);
        if (!segLenSec || segLenSec <= 0) throw new Error(browser.i18n.getMessage("dashNumberSegmentsError") || "Cannot compute number-based segments: no SegmentTimeline and duration/timescale missing or zero.");
        const segmentCount = Math.ceil(totalSec / segLenSec);
        for (let i = 0; i < segmentCount; i++) {
          const number = (tmpl.startNumber ?? 1) + i;
          const mediaPath = substituteVars(tmpl.media, rep, { number });
          mediaPaths.push(mediaPath);
          mediaZipPaths.push(sanitizeZipPath(mediaPath));
          segmentUrls.push(new URL(mediaPath, baseUrl).href);
        }
      }
    }

    return {
      initPath,
      initZipPath,
      initUrl,
      mediaPaths,
      mediaZipPaths,
      segmentUrls,
      firstIndex
    };
  }

  const sessionId = "mpd_conv_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
  const zipEntries = [];
  zipEntries.push({ name: mpdFilename, input: new TextEncoder().encode(mpdXmlText) });

  const tasks = [];
  let videoIndices = [];
  let audioIndices = [];
  function queueTemplateDownloads(repObj) {
    const info = buildSegmentUrlsForTemplate(repObj);
    tasks.push({ type: "template", rep: repObj, info });
  }
  function queueBaseDownload(repObj) {
    const baseURLText = repObj.baseURL || "";
    const resolvedUrl = new URL(baseURLText, mpdBase).href;
    let sanitized = sanitizeZipPath(baseURLText || "");
    if (!sanitized) sanitized = `${baseName}_rep${repObj.id}.mp4`;
    else if (!sanitized.match(/\.[a-zA-Z0-9]{1,6}$/)) sanitized = sanitized + `.mp4`;
    tasks.push({ type: "base", rep: repObj, url: resolvedUrl, zipName: sanitized, baseURLText });
  }
  function queueListDownload(repObj) {
    const initUrl = new URL(repObj.initializationUrl, mpdBase).href;
    const initZipPath = sanitizeZipPath(repObj.initializationUrl);

    const segmentUrls = repObj.segmentUrls.map(u => new URL(u, mpdBase).href);
    const segmentZipPaths = repObj.segmentUrls.map(u => sanitizeZipPath(u));

    tasks.push({
      type: "list",
      rep: repObj,
      info: {
        initUrl,
        initZipPath,
        segmentUrls,
        segmentZipPaths,
      }
    });
  }

  if (chosenVideoRep) {
    if (chosenVideoRep.type === "segmentTemplate") queueTemplateDownloads(chosenVideoRep);
    else if (chosenVideoRep.type === "segmentBase") queueBaseDownload(chosenVideoRep);
    else if (chosenVideoRep.type === "segmentList") queueListDownload(chosenVideoRep);
    else throw new Error(browser.i18n.getMessage("unsupportedVideoType") || "Unsupported video representation type");
  }

  if (chosenAudioRep) {
    if (chosenAudioRep.type === "segmentTemplate") queueTemplateDownloads(chosenAudioRep);
    else if (chosenAudioRep.type === "segmentBase") queueBaseDownload(chosenAudioRep);
    else if (chosenAudioRep.type === "segmentList") queueListDownload(chosenAudioRep);
    else throw new Error(browser.i18n.getMessage("unsupportedAudioType") || "Unsupported audio representation type");
  }

  let globalTotalSegments = 0;
  let globalProcessedSegments = 0;
  let downloadedBytes = 0;
  let useByteTracking = false;

  for (const t of tasks) {
    if (t.type === "template" || t.type === "list") {
      globalTotalSegments += t.info.segmentUrls.length;
    } else if (t.type === "base") {
      useByteTracking = true;
    }
  }

  if (useByteTracking) {
    loadingBar.removeAttribute("indeterminate");
    loadingBar._max = 0;
    loadingBar.value = 0;
  } else {
    loadingBar._max = globalTotalSegments;
    loadingBar.value = 0;
  }

  function addToMax(n) {
    if (!loadingBar._max) loadingBar._max = 0;
    loadingBar._max += n;
  }

  const mpdFixEnabled = (await browser.storage.local.get("mpd-fix").then((result) => result["mpd-fix"])) === "1";
  const repIdToLocalName = {};

  const parallelSettings = await browser.storage.local.get(['speed-boost', 'connections']);
  const isParallel = parallelSettings['speed-boost'] === '1';
  const concurrency = isParallel ? parseInt(parallelSettings['connections'] || '4', 10) : 1;
  const queue = new ParallelQueue(concurrency);

  let currentChunkGlobalIndex = 1;

  const processTask = async (t) => {
    const isVideo = t.rep.contentType === "video" || t.rep === chosenVideoRep;
    if (t.type === "template") {
      const initIdx = currentChunkGlobalIndex++;
      const segIndices = t.info.segmentUrls.map(() => currentChunkGlobalIndex++);
      if (isVideo) {
          videoIndices = [initIdx, ...segIndices];
      } else {
          audioIndices = [initIdx, ...segIndices];
      }

      const initBuf = await fetchWithProgress(t.info.initUrl);
      await storeConversionChunk(sessionId, initIdx, new Blob([initBuf]));
      zipEntries.push({ name: prefixedName(t.info.initZipPath), inputIdx: initIdx });

      const segTasks = t.info.segmentUrls.map((segUrl, i) => {
        const segIdx = segIndices[i];
        return queue.add(async () => {
          const segZipPath = t.info.mediaZipPaths[i];
          const buf = await fetchWithProgress(segUrl);
          await storeConversionChunk(sessionId, segIdx, new Blob([buf]));
          zipEntries.push({ name: prefixedName(segZipPath), inputIdx: segIdx });

          globalProcessedSegments++;
          updateSegmentProgressStatus(loadingBar, globalProcessedSegments, globalTotalSegments);
        });
      });
      await Promise.all(segTasks);

    } else if (t.type === "base") {
      const baseIdx = currentChunkGlobalIndex++;
      if (isVideo) {
          videoIndices = [baseIdx];
      } else {
          audioIndices = [baseIdx];
      }

      await queue.add(async () => {
          let lastReceivedForFile = 0;
          const arrayBuffer = await fetchWithProgress(t.url, {
            onStart: (contentLength) => {
              if (contentLength && contentLength > 0) addToMax(contentLength);
              else loadingBar.setAttribute("indeterminate", "");
            },
            onChunk: (received) => {
              const delta = received - lastReceivedForFile;
              lastReceivedForFile = received;
              downloadedBytes += delta;
              const max = loadingBar._max || 0;
              updateProgressStatus(loadingBar, downloadedBytes, max);
            }
          });

          const finalZipName = prefixedName(t.zipName);
          await storeConversionChunk(sessionId, baseIdx, new Blob([arrayBuffer]));
          zipEntries.push({ name: finalZipName, inputIdx: baseIdx });
          if (mpdFixEnabled) repIdToLocalName[t.rep.id] = t.zipName;
      });
    } else if (t.type === "list") {
      const initIdx = currentChunkGlobalIndex++;
      const segIndices = t.info.segmentUrls.map(() => currentChunkGlobalIndex++);
      if (isVideo) {
          videoIndices = [initIdx, ...segIndices];
      } else {
          audioIndices = [initIdx, ...segIndices];
      }

      const initBuf = await fetchWithProgress(t.info.initUrl);
      await storeConversionChunk(sessionId, initIdx, new Blob([initBuf]));
      zipEntries.push({ name: prefixedName(t.info.initZipPath), inputIdx: initIdx });

      const segTasks = t.info.segmentUrls.map((segUrl, i) => {
        const segIdx = segIndices[i];
        return queue.add(async () => {
            const segZipPath = t.info.segmentZipPaths[i];
            const buf = await fetchWithProgress(segUrl);
            await storeConversionChunk(sessionId, segIdx, new Blob([buf]));
            zipEntries.push({ name: prefixedName(segZipPath), inputIdx: segIdx });

            globalProcessedSegments++;
            updateSegmentProgressStatus(loadingBar, globalProcessedSegments, globalTotalSegments);
        });
      });
      await Promise.all(segTasks);

      if (mpdFixEnabled) repIdToLocalName[t.rep.id] = { type: "list", init: t.info.initZipPath, segments: t.info.segmentZipPaths };
    }
  };

  function pruneToSelectedRepresentations(documentNode, namespace, selectedIds) {
    const adaptationSets = Array.from(documentNode.getElementsByTagNameNS(namespace, "AdaptationSet"));
    for (const adaptationSet of adaptationSets) {
      const representations = Array.from(adaptationSet.getElementsByTagNameNS(namespace, "Representation"));
      for (const representation of representations) {
        if (!selectedIds.has(representation.getAttribute("id"))) representation.remove();
      }
      if (!adaptationSet.getElementsByTagNameNS(namespace, "Representation").length) adaptationSet.remove();
    }
  }

  try {
    for (const t of tasks) {
      await processTask(t);
    }

    if (mpdFixEnabled) {
      const selectedRepIds = new Set();
      if (chosenVideoRep) selectedRepIds.add(chosenVideoRep.id);
      if (chosenAudioRep) selectedRepIds.add(chosenAudioRep.id);

      pruneToSelectedRepresentations(xmlDoc, NS, selectedRepIds);
      for (const repId in repIdToLocalName) {
        const repNode = Array.from(xmlDoc.getElementsByTagNameNS(NS, "Representation"))
          .find(r => r.getAttribute("id") === repId);
        if (!repNode) continue;

        const meta = repIdToLocalName[repId];

        if (typeof meta === "string") {
          const segBases = Array.from(repNode.getElementsByTagNameNS(NS, "SegmentBase"));
          segBases.forEach(n => n.parentElement && n.parentElement.removeChild(n));
          let baseNode = repNode.getElementsByTagNameNS(NS, "BaseURL")[0];
          if (!baseNode) {
            baseNode = xmlDoc.createElementNS(NS, "BaseURL");
            if (repNode.firstChild) repNode.insertBefore(baseNode, repNode.firstChild);
            else repNode.appendChild(baseNode);
          }
          baseNode.textContent = meta;
        } else if (meta?.type === "list") {
          const initNode = repNode.getElementsByTagNameNS(NS, "Initialization")[0];
          if (initNode) {
            initNode.setAttribute("sourceURL", meta.init);
          }

          const segNodes = Array.from(repNode.getElementsByTagNameNS(NS, "SegmentURL"));
          segNodes.forEach((node, idx) => {
            if (meta.segments[idx]) {
              node.setAttribute("media", meta.segments[idx]);
            }
          });
        }
      }

      const serializer = new XMLSerializer();
      mpdXmlText = serializer.serializeToString(xmlDoc);
      zipEntries[0].input = new TextEncoder().encode(mpdXmlText);
    }

    try {
      const finalMax = loadingBar._max || downloadedBytes || 1;
      updateProgressStatus(loadingBar, downloadedBytes, finalMax);
    } catch (e) { }

    const db = await openCacheDB();
    const zipEntriesGenerator = async function* () {
      for (const entry of zipEntries) {
        if (entry.inputIdx !== undefined) {
          const chunk = await new Promise((resolve, reject) => {
            const tx = db.transaction([CHUNK_STORE_NAME], "readonly");
            const store = tx.objectStore(CHUNK_STORE_NAME);
            const req = store.get([sessionId, entry.inputIdx]);
            req.onsuccess = () => resolve(req.result?.data);
            req.onerror = () => reject(req.error);
          });
          yield { name: entry.name, input: chunk || new Blob([]) };
        } else {
          yield entry;
        }
      }
    };

    const gdriveStreamSettings = await browser.storage.local.get(['gdrive-stream', 'gdrive_token']);
    const isGdriveStream = gdriveStreamSettings['gdrive-stream'] === '1' && gdriveStreamSettings['gdrive_token'];
    let gdriveSessionUri = null;
    const zipName = `${baseName}.zip`;

    if (isGdriveStream) {
        try {
            gdriveSessionUri = await startGDriveStreamUpload(zipName, null, 'application/zip');
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(browser.i18n.getMessage("uploadingToGDrive", [zipName]) || `Uploading ${zipName} to Google Drive...`);
            }
            if (loadingBar) {
              const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
              if (statusInfo) {
                statusInfo.textContent = browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...";
              }
            }
        } catch (e) {
            console.error("Failed to start GDrive stream upload for MPD ZIP:", e);
        }
    }

    if (gdriveSessionUri) {
        const response = downloadZip(zipEntriesGenerator());
        const reader = response.body.getReader();
        let offset = 0;
        let dashBuffer = [];
        let dashBufferSize = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                dashBuffer.push(value);
                dashBufferSize += value.byteLength;

                if (dashBufferSize >= GDRIVE_CHUNK_UNIT) {
                    const fullData = new Uint8Array(dashBufferSize);
                    let pos = 0;
                    for (const b of dashBuffer) {
                        fullData.set(b, pos);
                        pos += b.byteLength;
                    }

                    const uploadSize = Math.floor(dashBufferSize / GDRIVE_CHUNK_UNIT) * GDRIVE_CHUNK_UNIT;
                    const dataToUpload = fullData.slice(0, uploadSize);
                    const remainder = fullData.slice(uploadSize);

                    let retries = 3;
                    let success = false;
                    while (retries > 0 && !success) {
                        try {
                            await uploadStreamChunk(gdriveSessionUri, dataToUpload, offset);
                            offset += uploadSize;
                            success = true;
                        } catch (e) {
                            retries--;
                            if (retries === 0) throw e;
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }

                    dashBuffer = [remainder];
                    dashBufferSize = remainder.byteLength;
                }

                if (loadingBar) {
                    const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                    if (statusInfo) {
                        statusInfo.textContent = (browser.i18n.getMessage("uploadingToGDriveShort") || "Uploading to Cloud...") + ` (${getHumanReadableSize(offset)})`;
                    }
                }
            }

            // Final flush for DASH
            if (dashBufferSize > 0) {
                const finalData = new Uint8Array(dashBufferSize);
                let pos = 0;
                for (const b of dashBuffer) {
                    finalData.set(b, pos);
                    pos += b.byteLength;
                }
                await uploadStreamChunk(gdriveSessionUri, finalData, offset);
                offset += dashBufferSize;
            }

            await uploadStreamChunk(gdriveSessionUri, new Uint8Array(0), offset, offset);
            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(browser.i18n.getMessage("uploadSuccessGDrive", [zipName]) || `Successfully saved ${zipName} to Google Drive!`);
            }
            await finalizeDownload(null, zipName, downloadMethod, loadingBar, true);
        } catch (e) {
            console.error("GDrive stream ZIP upload failed, falling back to local:", e);
            const zipBlob = await downloadZip(zipEntriesGenerator()).blob();
            await finalizeDownload(zipBlob, zipName, downloadMethod, loadingBar);
        }
    } else {
        const mpdToMp4Settings = await browser.storage.local.get(["gabung-stream", "mpd-to-mp4"]);
        const mpdToMp4Enabled = audioOnly || (mpdToMp4Settings["gabung-stream"] !== "0");

        if (mpdToMp4Enabled) {
            const concatenateChunks = async (dbInstance, sessId, indices) => {
                const blobs = [];
                for (const idx of indices) {
                    const chunk = await new Promise((resolve, reject) => {
                        const tx = dbInstance.transaction([CHUNK_STORE_NAME], "readonly");
                        const store = tx.objectStore(CHUNK_STORE_NAME);
                        const req = store.get([sessId, idx]);
                        req.onsuccess = () => resolve(req.result?.data);
                        req.onerror = () => reject(req.error);
                    });
                    if (chunk) {
                        blobs.push(chunk);
                    }
                }
                return new Blob(blobs);
            };


            if (loadingBar) {
                const statusInfo = loadingBar.parentNode.querySelector('.download-status-info');
                if (statusInfo) statusInfo.textContent = "Merging video and audio...";
            }

            let videoBlob = null;
            let audioBlob = null;

            if (videoIndices.length > 0) {
                videoBlob = await concatenateChunks(db, sessionId, videoIndices);
            }
            if (audioIndices.length > 0) {
                audioBlob = await concatenateChunks(db, sessionId, audioIndices);
            }

            if (!videoBlob && !audioBlob) {
                throw new Error("No video or audio tracks downloaded.");
            }

            let finalBlob;
            let finalFilename = baseName + ".mp4";

            if (videoBlob && audioBlob) {
                try {
                    finalBlob = await gabungkanVideoAudioKeMp4(videoBlob, audioBlob, '.mp4', '.mp4');
                } catch (muxErr) {
                    console.error("Failed to mux MPD tracks, falling back to ZIP:", muxErr);
                    const zipBlob = await downloadZip(zipEntriesGenerator()).blob();
                    await finalizeDownload(zipBlob, zipName, downloadMethod, loadingBar);
                    return;
                }
            } else if (videoBlob) {
                finalBlob = videoBlob;
            } else {
                finalBlob = audioBlob;
                finalFilename = baseName + ".m4a";
                if (audioOnly) {
                    const mp3Enabled = (await browser.storage.local.get('audio-to-mp3'))['audio-to-mp3'] === '1';
                    if (mp3Enabled) {
                        const converted = await convertM4aToMp3Direct(audioBlob, customFilename || (baseName + ".mp3"), loadingBar, throwIfCancelled);
                        finalBlob = converted.blob;
                        finalFilename = converted.filename;
                    } else {
                        finalFilename = (customFilename || baseName).replace(/\.[a-zA-Z0-9]+$/, '') + ".m4a";
                    }
                }
            }

            await finalizeDownload(finalBlob, finalFilename, downloadMethod, loadingBar);
            mdui.alert({
                headline: browser.i18n.getMessage("streamDownloadCompleteTitle") || "Download Complete",
                description: browser.i18n.getMessage("streamDownloadSaved") || "File has been saved.",
                confirmText: "OK"
            });
        } else {
            const zipBlob = await downloadZip(zipEntriesGenerator()).blob();
            await finalizeDownload(zipBlob, zipName, downloadMethod, loadingBar);
        }
    }

    showDialog(browser.i18n.getMessage("mpdDownloadCompleteMessage", [baseName]), browser.i18n.getMessage("mpdDownloadCompleteTitle"), {
      error: browser.i18n.getMessage("mpdDownloadCompleteSuccess", [zipName]),
      urls: { zip: isGdriveStream ? null : URL.createObjectURL(await downloadZip(zipEntriesGenerator()).blob()), mpd: mpdUrl },
      request,
      downloadMethod
    });
  } finally {
    await clearConversionChunks(sessionId);
  }

  function prefixedName(path) {
    if (!baseURLForZip) return path;
    if (path.startsWith(baseURLForZip)) return path;
    return baseURLForZip + path;
  }
}
