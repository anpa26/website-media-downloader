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

if (typeof browser === 'undefined') {
    var browser = chrome;
}

if (typeof importScripts === 'function') importScripts('lib/debug_logger.js', 'lib/detection_exclusions.js', 'lib/media_filename.js');

if (typeof importScripts === 'function') importScripts(
    'background/boot.js', 'background/detection/m3u8-youtube.js', 'background/jobs/persistent-jobs.js', 'background/cache/cache-db.js', 'background/detection/media-types.js',
    'background/detection/headers.js', 'background/settings.js', 'background/ui/toast.js', 'background/ui/notifikasi.js', 'background/jobs/history.js', 'background/jobs/autodownload.js',
    'background/detection/listeners.js', 'background/audio/audio.js', 'background/audio/audio-base.js', 'background/router.js', 'background/download/zip.js',
    'background/download/fetch-core.js', 'background/cloud/cloud-upload.js', 'background/cloud/cloud-save.js', 'background/cloud/cloud-paralel.js', 'background/cloud/cloud-auth.js', 'background/cloud/cloud-stream.js', 'background/download/fetch-download.js', 'background/init.js', 'background/cache/cache.js'
);
