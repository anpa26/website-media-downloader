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

let youtubeDetectionEnabled = true;
let youtubeDetectionTimer = null;
let lastVideoId = '';

const flagEnabled = (value, fallback = true) => value == null ? fallback : value === '1' || value === true;

function getCodec(mimeType) {
    const codec = mimeType?.match(/codecs="([^"]+)"/)?.[1]?.split('.')[0]?.toUpperCase() || '';
    if (codec.startsWith('VP09') || codec.startsWith('VP9')) return 'VP9';
    if (codec.startsWith('AVC')) return 'H264';
    if (codec.startsWith('HEVC') || codec.startsWith('HVC')) return 'H265';
    if (codec.startsWith('AV01')) return 'AV1';
    return 'unknown';
}

const getLabel = height => height ? (height >= 2160 ? '4K' : height >= 1440 ? '1440p' : `${height}p`) : '';

function taggedAudioUrl(audio) {
    let url = audio.url;
    if (!url.includes('.m4a') && !url.includes('.webm')) {
        url += url.includes('mime=audio%2Fwebm') || url.includes('mime=audio/webm') ? '#audio.webm' : '#audio.m4a';
    }
    return url;
}

function bestAudioTracks(audioItems) {
    const tracks = new Map();
    for (const audio of audioItems || []) {
        const key = audio.displayName || audio.language || 'default';
        if (!tracks.has(key) || (audio.bitrate || 0) > (tracks.get(key).bitrate || 0)) tracks.set(key, audio);
    }
    return [...tracks.values()];
}

function mapYoutubeStreams(data) {
    const ytFormats = [];
    const urls = [];
    const addUrl = url => { if (!urls.includes(url)) urls.push(url); };

    for (const item of data.muxed || []) {
        const demuxer = item.mimeType?.includes('webm') ? 'webm' : 'mp4';
        let videoUrl = item.url;
        if (!videoUrl.includes('.mp4') && !videoUrl.includes('.webm')) videoUrl += `#video.${demuxer}`;
        ytFormats.push({ videoUrl, audioUrl: null, width: item.width || 0, height: item.height || 0,
            bitrate: item.bitrate || 0, contentLength: item.contentLength || 0, demuxer,
            codec: getCodec(item.mimeType), label: getLabel(item.height), hasAudio: true, audioTrack: null });
        addUrl(videoUrl);
    }

    const audioTracks = bestAudioTracks(data.audio);
    for (const video of data.video || []) {
        const demuxer = video.mimeType?.includes('webm') ? 'webm' : 'mp4';
        let videoUrl = video.url;
        if (!videoUrl.includes('.mp4') && !videoUrl.includes('.webm')) videoUrl += `#video.${demuxer}`;
        if (audioTracks.length) {
            for (const audio of audioTracks) {
                ytFormats.push({ videoUrl, audioUrl: taggedAudioUrl(audio), width: video.width || 0,
                    height: video.height || 0, bitrate: (video.bitrate || 0) + (audio.bitrate || 0),
                    contentLength: video.contentLength || 0, demuxer, codec: getCodec(video.mimeType),
                    label: getLabel(video.height), hasAudio: true,
                    audioTrack: audio.trackId ? { id: audio.trackId, displayName: audio.displayName,
                        display_name: audio.displayName, language: audio.language || 'und', lang: audio.language || 'und',
                        audioIsDefault: audio.isDefault, audio_is_default: audio.isDefault } : null });
            }
        } else {
            ytFormats.push({ videoUrl, audioUrl: null, width: video.width || 0, height: video.height || 0,
                bitrate: video.bitrate || 0, contentLength: video.contentLength || 0, demuxer,
                codec: getCodec(video.mimeType), label: getLabel(video.height), hasAudio: false, audioTrack: null });
        }
        addUrl(videoUrl);
    }
    for (const audio of data.audio || []) addUrl(taggedAudioUrl(audio));
    return { ytFormats, urls };
}

function getYoutubeVideoId() {
    try {
        const url = new URL(location.href);
        if (url.hostname.includes('youtube.com')) return url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.searchParams.get('v');
        if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    } catch (_) {}
    return null;
}

function reportYoutubeData(data) {
    if (!youtubeDetectionEnabled || !data?.videoDetails) return;
    const title = data.videoDetails.title || document.title;
    const { ytFormats, urls } = mapYoutubeStreams(data);
    if (ytFormats.length) chrome.runtime.sendMessage({ action: 'reportDetectedMedia', urls, pageTitle: title,
        pageUrl: location.href, is_youtube: true, ytFormats, ytSubtitles: data.subtitles || null });
    for (const audio of bestAudioTracks(data.audio)) chrome.runtime.sendMessage({ action: 'reportDetectedMedia',
        urls: [taggedAudioUrl(audio)], pageTitle: `${title} - ${audio.displayName}`, pageUrl: location.href, is_youtube: false });
    for (const subtitle of data.subtitles || []) chrome.runtime.sendMessage({ action: 'reportDetectedMedia',
        urls: [`${subtitle.vttUrl}#subtitle.vtt`], pageTitle: `${title} - ${subtitle.displayName}`,
        pageUrl: location.href, is_youtube: false });
}

function checkForVideoChange() {
    if (!youtubeDetectionEnabled) return;
    const videoId = getYoutubeVideoId();
    if (!videoId || videoId === lastVideoId) return;
    lastVideoId = videoId;
    chrome.runtime.sendMessage({ action: 'extract', videoId }, response => {
        if (!youtubeDetectionEnabled) return;
        if (response?.success) reportYoutubeData(response.data);
        else if (!response?.disabled) console.error('[website-media-downloader] Extraction failed:', response?.error || 'No response');
    });
}

function syncYoutubeDetection(value) {
    youtubeDetectionEnabled = flagEnabled(value);
    if (!youtubeDetectionEnabled) {
        if (youtubeDetectionTimer) clearInterval(youtubeDetectionTimer);
        youtubeDetectionTimer = null;
        lastVideoId = '';
        return;
    }
    if (!youtubeDetectionTimer) youtubeDetectionTimer = setInterval(checkForVideoChange, 1500);
    checkForVideoChange();
}

chrome.storage.local.get('youtube-detection', result => syncYoutubeDetection(result['youtube-detection']));
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['youtube-detection']) syncYoutubeDetection(changes['youtube-detection'].newValue);
});
