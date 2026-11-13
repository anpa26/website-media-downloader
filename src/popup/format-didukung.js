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



document.addEventListener('DOMContentLoaded', () => {
    const extensionsMap = {
        video: [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"],
        audio: [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"],
        stream: [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"],
        subtitle: [".vtt", ".srt", ".ass", ".ssa", ".ttml", ".dfxp", ".lrc", ".smi", ".sub", ".sbv"],
        image: [".webp", ".png", ".jpg", ".jpeg", ".gif"],
        file: [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".apk", ".dmg", ".iso", ".bin", ".pdf", ".epub", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]
    };

    document.querySelectorAll('.info-extensions').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const type = btn.getAttribute('data-type');
            if (extensionsMap[type]) {
                let parentItem = btn.closest('.setting-item');
                let existingList = parentItem.querySelector('.inline-extension-list');
                if (existingList) {
                    existingList.remove();
                    parentItem.classList.remove('extension-list-open');
                    btn.setAttribute('aria-expanded', 'false');
                } else {
                    const titleStr = type.charAt(0).toUpperCase() + type.slice(1);
                    const listDiv = document.createElement('div');
                    listDiv.className = 'inline-extension-list';
                    listDiv.setAttribute('role', 'note');
                    let titleText = browser.i18n.getMessage("supportedFormats");
                    if (titleText) titleText = titleText.replace('{type}', titleStr);
                    else titleText = `Supported ${titleStr} formats:`;
                    const title = document.createElement('span');
                    title.className = 'inline-extension-title';
                    title.textContent = titleText;
                    const formats = document.createElement('div');
                    formats.className = 'inline-extension-formats';
                    formats.textContent = extensionsMap[type].join(', ');
                    listDiv.append(title, formats);
                    parentItem.classList.add('extension-list-open');
                    btn.setAttribute('aria-expanded', 'true');
                    parentItem.appendChild(listDiv);
                }
            }
        });
    });
});
