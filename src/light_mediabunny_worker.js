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

importScripts('libraries/mediabunny.min.js');

let activeOutputs = new Set();

function toIso3(language) {
    const languages = {
        en: 'eng', id: 'ind', ja: 'jpn', ko: 'kor', zh: 'zho', fr: 'fra', de: 'deu',
        es: 'spa', pt: 'por', ru: 'rus', ar: 'ara', hi: 'hin', tr: 'tur', it: 'ita',
        nl: 'nld', pl: 'pol', th: 'tha', vi: 'vie', sv: 'swe', fi: 'fin', da: 'dan',
        no: 'nor', cs: 'ces', sk: 'slk', ro: 'ron', hu: 'hun', el: 'ell', uk: 'ukr'
    };
    const base = String(language || 'und').split('-')[0].toLowerCase();
    return base.length === 3 ? base : (languages[base] || 'und');
}

function attachSubtitles(output, subtitles) {
    const sources = [];
    for (let index = 0; index < subtitles.length; index++) {
        const subtitle = subtitles[index];
        const source = new Mediabunny.TextSubtitleSource('webvtt');
        const languageCode = toIso3(subtitle.language);
        const metadata = { languageCode };
        if (languageCode === 'und') metadata.name = subtitle.displayName || `Subtitle ${index + 1}`;
        output.addSubtitleTrack(source, metadata);
        sources.push(source);
    }
    return sources;
}

function createProgressReporter(conversions) {
    let lastPercent = -1;
    let lastSentAt = 0;
    return () => {
        const percent = Math.round(Math.min(...conversions.map(item => item.progress || 0)) * 100);
        const now = Date.now();
        if (percent === lastPercent || (percent < 100 && now - lastSentAt < 120)) return;
        lastPercent = percent;
        lastSentAt = now;
        postMessage({ type: 'progress', percent });
    };
}

async function runMux(message) {
    const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } = Mediabunny;
    const inputs = [];
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    activeOutputs.add(output);
    try {
        const videoInput = new Input({ source: new BlobSource(new Blob([message.videoBuffer])), formats: ALL_FORMATS });
        const audioInput = new Input({ source: new BlobSource(new Blob([message.audioBuffer])), formats: ALL_FORMATS });
        inputs.push(videoInput, audioInput);
        const copy = { mode: 'forced' };
        const conversions = await Promise.all([
            Conversion.init({ input: videoInput, output, video: {}, audio: { discard: true }, copy, composable: true, showWarnings: false }),
            Conversion.init({ input: audioInput, output, video: { discard: true }, audio: {}, copy, composable: true, showWarnings: false })
        ]);
        if (conversions.some(conversion => conversion.utilizedTracks.length === 0)) {
            const reasons = conversions.flatMap(conversion => conversion.discardedTracks)
                .map(item => item.reason).filter(Boolean).join(', ');
            throw new Error(`The selected streams cannot be copied into MP4${reasons ? ` (${reasons})` : ''}.`);
        }
        const subtitleSources = attachSubtitles(output, message.subtitles || []);
        const report = createProgressReporter(conversions);
        for (const conversion of conversions) {
            conversion.onProgress = progress => { conversion.progress = progress; report(); };
        }
        await output.start();
        await Promise.all([
            ...conversions.map(conversion => conversion.execute()),
            ...subtitleSources.map((source, index) => source.add(message.subtitles[index].text))
        ]);
        await output.finalize();
        const buffer = output.target.buffer;
        if (!buffer) throw new Error('Mediabunny did not produce an MP4 file.');
        postMessage({ type: 'result', buffer }, [buffer]);
    } finally {
        activeOutputs.delete(output);
        inputs.forEach(input => input.dispose());
    }
}

async function runEmbed(message) {
    const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } = Mediabunny;
    const input = new Input({ source: new BlobSource(new Blob([message.videoBuffer])), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    activeOutputs.add(output);
    try {
        const conversion = await Conversion.init({
            input, output, video: {}, audio: {}, copy: { mode: 'forced' },
            composable: true, showWarnings: false
        });
        if (!conversion.utilizedTracks.length) {
            const reasons = conversion.discardedTracks.map(item => item.reason).filter(Boolean).join(', ');
            throw new Error(`The video cannot be copied into MP4${reasons ? ` (${reasons})` : ''}.`);
        }
        const subtitleSources = attachSubtitles(output, message.subtitles || []);
        let lastPercent = -1;
        let lastSentAt = 0;
        conversion.onProgress = progress => {
            const percent = Math.round(progress * 100);
            const now = Date.now();
            if (percent === lastPercent || (percent < 100 && now - lastSentAt < 120)) return;
            lastPercent = percent;
            lastSentAt = now;
            postMessage({ type: 'progress', percent });
        };
        await output.start();
        await Promise.all([
            conversion.execute(),
            ...subtitleSources.map((source, index) => source.add(message.subtitles[index].text))
        ]);
        await output.finalize();
        const buffer = output.target.buffer;
        if (!buffer) throw new Error('Mediabunny did not produce an MP4 file.');
        postMessage({ type: 'result', buffer }, [buffer]);
    } finally {
        activeOutputs.delete(output);
        input.dispose();
    }
}

self.onmessage = async event => {
    if (event.data?.type === 'cancel') {
        await Promise.allSettled(Array.from(activeOutputs, output => output.cancel()));
        return;
    }
    try {
        if (event.data?.type === 'mux') await runMux(event.data);
        else if (event.data?.type === 'embed') await runEmbed(event.data);
        else throw new Error('Unknown Mediabunny worker operation.');
    } catch (error) {
        postMessage({ type: 'error', message: error?.message || String(error), stack: error?.stack || '' });
    }
};
