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



async function getM3u8BlobUrlFromMpd(mpdUrl, headers) {
  try {
    const fetchHeaders = headers ? Object.fromEntries(headers.map(h => [h.name, h.value])) : {};
    const resp = await fetch(mpdUrl, { headers: fetchHeaders });
    if (!resp.ok) throw new Error("Failed to fetch MPD");
    const mpdXmlText = await resp.text();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(mpdXmlText, "application/xml");
    const NS = xmlDoc.documentElement.namespaceURI || "urn:mpeg:dash:schema:mpd:2011";

    const mpdBase = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);
    const mpdRoot = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0] || xmlDoc.getElementsByTagName("MPD")[0];
    const totalDurationISO = mpdRoot ? mpdRoot.getAttribute("mediaPresentationDuration") : null;

    const parseISODuration = d => {
      if (!d) return 0;
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

    const periodList = xmlDoc.getElementsByTagNameNS(NS, "Period").length ? xmlDoc.getElementsByTagNameNS(NS, "Period") : xmlDoc.getElementsByTagName("Period");
    if (!periodList || periodList.length === 0) throw new Error("No Period found in MPD");
    const period = periodList[0];

    const baseURLNode = period.getElementsByTagNameNS(NS, "BaseURL")[0] || period.getElementsByTagName("BaseURL")[0] || (mpdRoot ? (mpdRoot.getElementsByTagNameNS(NS, "BaseURL")[0] || mpdRoot.getElementsByTagName("BaseURL")[0]) : null);
    let resolvedBase = mpdBase;
    if (baseURLNode) {
      const txt = baseURLNode.textContent.trim();
      if (txt.match(/^https?:\/\//i)) {
        resolvedBase = txt;
      } else {
        resolvedBase = new URL(txt, mpdBase).href;
      }
    }
    if (!resolvedBase.endsWith("/")) resolvedBase += "/";

    const allSets = Array.from(period.getElementsByTagNameNS(NS, "AdaptationSet").length ? period.getElementsByTagNameNS(NS, "AdaptationSet") : period.getElementsByTagName("AdaptationSet"));

    function getPlaylistForAdaptationSet(asNode) {
      const reps = Array.from(asNode.getElementsByTagNameNS(NS, "Representation").length ? asNode.getElementsByTagNameNS(NS, "Representation") : asNode.getElementsByTagName("Representation"));
      if (reps.length === 0) return null;

      const rep = reps[0];
      const repId = rep.getAttribute("id") || "";
      const bandwidth = rep.getAttribute("bandwidth") || "0";

      const setSegTmplNode = asNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0] || asNode.getElementsByTagName("SegmentTemplate")[0];
      const repSegTmplNode = rep.getElementsByTagNameNS(NS, "SegmentTemplate")[0] || rep.getElementsByTagName("SegmentTemplate")[0];
      const tmplNode = repSegTmplNode || setSegTmplNode;

      const setSegListNode = asNode.getElementsByTagNameNS(NS, "SegmentList")[0] || asNode.getElementsByTagName("SegmentList")[0];
      const repSegListNode = rep.getElementsByTagNameNS(NS, "SegmentList")[0] || rep.getElementsByTagName("SegmentList")[0];
      const listNode = repSegListNode || setSegListNode;

      let initUrl = "";
      let segmentUrls = [];
      let durations = [];

      const substituteVars = (path, extra = {}) => {
        if (!path) return "";
        return path
          .replace(/\$RepresentationID\$/g, repId)
          .replace(/\$Bandwidth\$/g, bandwidth)
          .replace(/\$Number\$/g, extra.number !== undefined ? String(extra.number) : "$Number$")
          .replace(/\$Time\$/g, extra.time !== undefined ? String(extra.time) : "$Time$");
      };

      if (tmplNode) {
        const timescale = parseInt(tmplNode.getAttribute("timescale") || "1", 10);
        const startNumber = tmplNode.getAttribute("startNumber") !== null ? parseInt(tmplNode.getAttribute("startNumber"), 10) : 1;
        const duration = parseInt(tmplNode.getAttribute("duration") || "0", 10);
        const initPattern = tmplNode.getAttribute("initialization") || "";
        const mediaPattern = tmplNode.getAttribute("media") || "";

        if (initPattern) {
          initUrl = new URL(substituteVars(initPattern), resolvedBase).href;
        }

        const timelineNode = tmplNode.getElementsByTagNameNS(NS, "SegmentTimeline")[0] || tmplNode.getElementsByTagName("SegmentTimeline")[0];
        if (timelineNode) {
          const sElems = Array.from(timelineNode.getElementsByTagNameNS(NS, "S").length ? timelineNode.getElementsByTagNameNS(NS, "S") : timelineNode.getElementsByTagName("S"));
          let cursor = null;
          let index = 0;
          for (let i = 0; i < sElems.length; i++) {
            const s = sElems[i];
            const tAttr = s.getAttribute("t");
            const dAttr = s.getAttribute("d");
            const rAttr = s.getAttribute("r");
            if (!dAttr) continue;
            const d = parseInt(dAttr, 10);
            const r = rAttr !== null ? parseInt(rAttr, 10) : 0;
            if (tAttr !== null) cursor = parseInt(tAttr, 10);
            else if (cursor === null) cursor = 0;

            const repeatCount = r + 1;
            for (let k = 0; k < repeatCount; k++) {
              const mediaPath = substituteVars(mediaPattern, { time: cursor, number: startNumber + index });
              segmentUrls.push(new URL(mediaPath, resolvedBase).href);
              durations.push(d / timescale);
              cursor += d;
              index++;
            }
          }
        } else if (duration > 0 && totalSec > 0) {
          const segLenSec = duration / timescale;
          const count = Math.ceil(totalSec / segLenSec);
          for (let i = 0; i < count; i++) {
            const mediaPath = substituteVars(mediaPattern, { number: startNumber + i });
            segmentUrls.push(new URL(mediaPath, resolvedBase).href);
            durations.push(segLenSec);
          }
        }
      } else if (listNode) {
        const initNode = listNode.getElementsByTagNameNS(NS, "Initialization")[0] || listNode.getElementsByTagName("Initialization")[0];
        const initPath = initNode?.getAttribute("sourceURL") || initNode?.textContent?.trim() || "";
        if (initPath) {
          initUrl = new URL(substituteVars(initPath), resolvedBase).href;
        }

        const timescale = parseInt(listNode.getAttribute("timescale") || "1", 10);
        const duration = parseInt(listNode.getAttribute("duration") || "0", 10);
        const segLenSec = duration / timescale;

        const segNodes = Array.from(listNode.getElementsByTagNameNS(NS, "SegmentURL").length ? listNode.getElementsByTagNameNS(NS, "SegmentURL") : listNode.getElementsByTagName("SegmentURL"));
        for (let i = 0; i < segNodes.length; i++) {
          const mediaPath = segNodes[i].getAttribute("media") || "";
          segmentUrls.push(new URL(substituteVars(mediaPath), resolvedBase).href);
          durations.push(segLenSec || 5);
        }
      }

      if (segmentUrls.length === 0) return null;

      let m3u8 = "#EXTM3U\n#EXT-X-VERSION:6\n";
      const maxDur = Math.max(...durations, 5);
      m3u8 += `#EXT-X-TARGETDURATION:${Math.ceil(maxDur)}\n`;
      m3u8 += "#EXT-X-MEDIA-SEQUENCE:1\n";
      if (initUrl) {
        m3u8 += `#EXT-X-MAP:URI="${initUrl}"\n`;
      }
      for (let i = 0; i < segmentUrls.length; i++) {
        m3u8 += `#EXTINF:${durations[i].toFixed(3)},\n${segmentUrls[i]}\n`;
      }
      m3u8 += "#EXT-X-ENDLIST\n";

      return {
        m3u8,
        bandwidth: parseInt(bandwidth, 10)
      };
    }

    let videoSet = allSets.find(as => {
      const mime = (as.getAttribute("mimeType") || "").toLowerCase();
      const type = (as.getAttribute("contentType") || "").toLowerCase();
      return mime.startsWith("video/") || type === "video";
    });
    let audioSet = allSets.find(as => {
      const mime = (as.getAttribute("mimeType") || "").toLowerCase();
      const type = (as.getAttribute("contentType") || "").toLowerCase();
      return mime.startsWith("audio/") || type === "audio";
    });

    if (!videoSet && allSets.length > 0) {
      videoSet = allSets[0];
    }

    const videoPlay = videoSet ? getPlaylistForAdaptationSet(videoSet) : null;
    const audioPlay = audioSet ? getPlaylistForAdaptationSet(audioSet) : null;

    if (!videoPlay && !audioPlay) throw new Error("Could not parse any media track from MPD");

    if (videoPlay && audioPlay) {
      const videoBlob = new Blob([videoPlay.m3u8], { type: "application/x-mpegURL" });
      const audioBlob = new Blob([audioPlay.m3u8], { type: "application/x-mpegURL" });
      const videoUrl = URL.createObjectURL(videoBlob);
      const audioUrl = URL.createObjectURL(audioBlob);

      let master = "#EXTM3U\n#EXT-X-VERSION:6\n";
      master += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${audioUrl}"\n`;
      master += `#EXT-X-STREAM-INF:BANDWIDTH=${videoPlay.bandwidth || 1000000},AUDIO="audio"\n${videoUrl}\n`;

      return URL.createObjectURL(new Blob([master], { type: "application/x-mpegURL" }));
    } else {
      const singlePlay = videoPlay || audioPlay;
      const blob = new Blob([singlePlay.m3u8], { type: "application/x-mpegURL" });
      return URL.createObjectURL(blob);
    }
  } catch (e) {
    console.error("Error in getM3u8BlobUrlFromMpd:", e);
    return mpdUrl;
  }
}
