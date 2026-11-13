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

function injectNotificationScript(tabId, filename, url, mediaType, title, themeColor, isDrm = false, hlsFormats = null, stackNotifications = false, uiScale = '85%') {
    if (!browser.scripting) return;

    const modalTranslations = {
        qualityModalTitle: browser.i18n.getMessage("qualityModalTitle") || "Pilih Kualitas Unduhan",
        qualityModalTabVideo: browser.i18n.getMessage("qualityModalTabVideo") || "Video + Audio",
        qualityModalTabAudio: browser.i18n.getMessage("qualityModalTabAudio") || "Audio Saja",
        qualityModalFormatLabel: browser.i18n.getMessage("qualityModalFormatLabel") || "Format / Tipe",
        qualityModalCodecLabel: browser.i18n.getMessage("qualityModalCodecLabel") || "Codec",
        qualityModalQualityLabel: browser.i18n.getMessage("qualityModalQualityLabel") || "Kualitas / Resolusi",
        qualityModalAudioExplain: browser.i18n.getMessage("qualityModalAudioExplain") || "Audio akan langsung diekstrak dan disimpan dalam format audio kualitas tinggi (.m4a/.webm).",
        qualityModalCancelBtn: browser.i18n.getMessage("qualityModalCancelBtn") || "Batal",
        qualityModalDownloadBtn: browser.i18n.getMessage("qualityModalDownloadBtn") || "Unduh"
    };

    browser.scripting.executeScript({
        target: { tabId: tabId },
        func: (name, downloadUrl, dlLabel, type, titleLabel, primaryColor, drm, formats, stack, t, uiScale) => {
             let safeColor = primaryColor || '#8ab4f8';
             if (typeof safeColor === 'string') {
                 safeColor = safeColor.trim();
                 if (!safeColor.startsWith('#') && !safeColor.startsWith('rgb')) {
                     safeColor = '#' + safeColor;
                 }
                 if (/^#[0-9a-fA-F]{3}$/.test(safeColor)) {
                     safeColor = '#' + safeColor[1] + safeColor[1] + safeColor[2] + safeColor[2] + safeColor[3] + safeColor[3];
                 }
             }
             function getContrastColor(hex) {
                 if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#121212';
                 const r = parseInt(hex.slice(1, 3), 16);
                 const g = parseInt(hex.slice(3, 5), 16);
                 const b = parseInt(hex.slice(5, 7), 16);
                 const yiq = (r * 299 + g * 587 + b * 114) / 1000;
                 return yiq >= 128 ? '#121212' : '#ffffff';
             }
             function hexToRgba(hex, alpha) {
                 if (!hex || !hex.startsWith('#') || hex.length !== 7) return `rgba(255, 255, 255, ${alpha})`;
                 const r = parseInt(hex.slice(1, 3), 16);
                 const g = parseInt(hex.slice(3, 5), 16);
                 const b = parseInt(hex.slice(5, 7), 16);
                 return `rgba(${r}, ${g}, ${b}, ${alpha})`;
             }
             const btnTextColor = getContrastColor(safeColor);
             const encodedColor = encodeURIComponent(safeColor);

             if (!stack) {
                 const existingToasts = document.querySelectorAll('.mdu-toast');
                 existingToasts.forEach(t => {
                     t.remove();
                 });
                 const existingModal = document.querySelector('.mdu-media-modal-backdrop');
                 if (existingModal) existingModal.remove();
             } else {
                 const existingToasts = document.querySelectorAll('.mdu-toast');
                 existingToasts.forEach(t => {
                     const currentBottom = parseInt(t.style.bottom || '24');
                     t.style.bottom = (currentBottom + 90) + 'px';
                 });
             }

             const toast = document.createElement('div');
             toast.className = 'mdu-toast';

            const icons = {
                video: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
                audio: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
                image: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
                stream: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM8 15c0-2.21 1.79-4 4-4s4 1.79 4 4l-4-2-4 2z"/></svg>',
                subtitle: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-1 12H5V8h14v8zM7 10h2v2H7v-2zm4 0h6v2h-6v-2z"/></svg>'
            };
            const icon = icons[type] || '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';

            toast.innerHTML = `
                <div class="mdu-toast-inner">
                    <div class="mdu-toast-icon">${icon}</div>
                    <div class="mdu-toast-content">
                        <div class="mdu-toast-title">${titleLabel}</div>
                        <div class="mdu-toast-filename">${name}</div>
                    </div>
                    <div class="mdu-toast-actions">
                        ${drm ? '' : `<button class="mdu-toast-dl-btn">${dlLabel}</button>`}
                    </div>
                </div>
                <div class="mdu-toast-progress-bar"></div>
            `;

            toast.style.cssText = `
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
                background: rgba(25, 25, 25, 0.45); color: white; border-radius: 9999px;
                z-index: 2147483647; width: ${drm ? '420px' : 'auto'}; min-width: 320px; max-width: 480px;
                box-shadow: 0 12px 40px rgba(0,0,0,0.4); font-family: 'Segoe UI', Roboto, sans-serif;
                overflow: hidden; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255,255,255,0.18);
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                animation: mdu-toast-in 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                touch-action: none; user-select: none; -webkit-user-select: none;
                zoom: ${uiScale || '85%'};
            `;
            if (uiScale) toast.style.zoom = uiScale;

            const inner = toast.querySelector('.mdu-toast-inner');
            inner.style.cssText = `display: flex; align-items: center; padding: 14px 20px; gap: 14px;`;

            const iconCont = toast.querySelector('.mdu-toast-icon');
            iconCont.style.cssText = `color: ${safeColor}; flex-shrink: 0; display: flex; align-items: center;`;

            const content = toast.querySelector('.mdu-toast-content');
            content.style.cssText = `flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;

            const title = toast.querySelector('.mdu-toast-title');
            title.style.cssText = `font-size: 13px; color: ${safeColor}; font-weight: 600; opacity: 1;`;

            const filename = toast.querySelector('.mdu-toast-filename');
            filename.style.cssText = `font-size: 14px; ${drm ? 'white-space: normal;' : 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'} color: rgba(255,255,255,0.9);`;

            const actions = toast.querySelector('.mdu-toast-actions');
            actions.style.cssText = `display: flex; align-items: center; flex-shrink: 0;`;

            const showQualityModal = () => {
                const existingModal = document.querySelector('.mdu-media-modal-backdrop');
                if (existingModal) existingModal.remove();

                const modalBackdrop = document.createElement('div');
                modalBackdrop.className = 'mdu-media-modal-backdrop';
                modalBackdrop.style.cssText = `
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); z-index: 2147483647;
                    display: flex; align-items: center; justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    animation: mdu-fade-in 0.3s ease;
                `;

                modalBackdrop.innerHTML = `
                    <div class="mdu-media-modal" style="background: rgba(30, 30, 30, 0.85); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(25px); color: white; border-radius: 28px; width: 420px; padding: 24px; box-shadow: 0 24px 48px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 20px; animation: mdu-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); zoom: ${uiScale || '85%'};">
                        <div style="font-size: 18px; font-weight: 600; color: ${safeColor};">${t.qualityModalTitle}</div>
                        <div style="font-size: 14px; color: rgba(255,255,255,0.7); max-height: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>

                        <!-- Tab Video / Audio -->
                        <div style="display: flex; background: rgba(255,255,255,0.08); padding: 4px; border-radius: 12px; gap: 4px;">
                            <button id="tab-video" style="flex: 1; border: none; padding: 8px; border-radius: 8px; background: ${safeColor}; color: ${btnTextColor}; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;">${t.qualityModalTabVideo}</button>
                            <button id="tab-audio" style="flex: 1; border: none; padding: 8px; border-radius: 8px; background: transparent; color: white; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;">${t.qualityModalTabAudio}</button>
                        </div>

                        <!-- Video Options Container -->
                        <div id="video-options-container" style="display: flex; flex-direction: column; gap: 12px;">
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <label class="mdu-modal-label">${t.qualityModalFormatLabel}</label>
                                <select id="select-demuxer" class="mdu-modal-select"></select>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <label class="mdu-modal-label">${t.qualityModalCodecLabel}</label>
                                <select id="select-codec" class="mdu-modal-select"></select>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <label class="mdu-modal-label">${t.qualityModalQualityLabel}</label>
                                <select id="select-quality" class="mdu-modal-select"></select>
                            </div>
                        </div>

                        <!-- Audio Options Container -->
                        <div id="audio-options-container" style="display: none; flex-direction: column; gap: 12px;">
                            <div style="font-size: 13px; color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); line-height: 1.4;">
                                ${t.qualityModalAudioExplain}
                            </div>
                        </div>

                        <!-- Footer Buttons -->
                        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px;">
                            <button id="btn-cancel" style="background: transparent; color: white; border: 1px solid rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 14px; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;">${t.qualityModalCancelBtn}</button>
                            <button id="btn-download" style="background: ${safeColor}; color: ${btnTextColor}; border: none; padding: 10px 24px; border-radius: 14px; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;">${t.qualityModalDownloadBtn}</button>
                        </div>
                    </div>

                    <style>
                        @keyframes mdu-fade-in { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes mdu-scale-in { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }

                        .mdu-modal-label {
                            font-size: 12px !important;
                            color: rgba(255,255,255,0.5) !important;
                            font-weight: 600 !important;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                            margin: 0 !important;
                            padding: 0 !important;
                            line-height: 1.4 !important;
                        }

                        .mdu-modal-select {
                            appearance: none !important;
                            -webkit-appearance: none !important;
                            -moz-appearance: none !important;
                            background-color: ${hexToRgba(safeColor, 0.15)} !important;
                            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${encodedColor}"><path d="M7 10l5 5 5-5z"/></svg>') !important;
                            background-repeat: no-repeat !important;
                            background-position: right 12px center !important;
                            background-size: 20px !important;
                            color: white !important;
                            border: 1.5px solid ${hexToRgba(safeColor, 0.35)} !important;
                            padding: 11px 38px 11px 14px !important;
                            border-radius: 12px !important;
                            font-size: 13px !important;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                            font-weight: 500 !important;
                            width: 100% !important;
                            outline: none !important;
                            cursor: pointer !important;
                            transition: all 0.2s ease !important;
                            box-sizing: border-box !important;
                            box-shadow: 0 2px 6px rgba(0,0,0,0.15) !important;
                            line-height: 1.4 !important;
                            margin: 0 !important;
                            min-height: 42px !important;
                        }

                        .mdu-modal-select:hover {
                            border-color: rgba(255,255,255,0.3) !important;
                            background-color: rgba(255,255,255,0.12) !important;
                            box-shadow: 0 3px 10px rgba(0,0,0,0.2) !important;
                        }

                        .mdu-modal-select:focus {
                            border-color: ${safeColor} !important;
                            box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2), 0 3px 10px rgba(0,0,0,0.2) !important;
                        }

                        .mdu-modal-select option {
                            background: #2a2a2a !important;
                            color: white !important;
                            padding: 10px 14px !important;
                            font-size: 13px !important;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                        }

                        .mdu-modal-select option:hover,
                        .mdu-modal-select option:checked {
                            background: ${safeColor} !important;
                            color: ${btnTextColor} !important;
                        }
                    </style>
                `;

                document.body.appendChild(modalBackdrop);

                let activeMode = "video";
                const tabVideo = modalBackdrop.querySelector('#tab-video');
                const tabAudio = modalBackdrop.querySelector('#tab-audio');
                const videoOptions = modalBackdrop.querySelector('#video-options-container');
                const audioOptions = modalBackdrop.querySelector('#audio-options-container');

                tabVideo.onclick = () => {
                    activeMode = "video";
                    tabVideo.style.background = primaryColor;
                    tabVideo.style.color = '#121212';
                    tabAudio.style.background = 'transparent';
                    tabAudio.style.color = 'white';
                    videoOptions.style.display = 'flex';
                    audioOptions.style.display = 'none';
                };

                tabAudio.onclick = () => {
                    activeMode = "audio";
                    tabAudio.style.background = primaryColor;
                    tabAudio.style.color = '#121212';
                    tabVideo.style.background = 'transparent';
                    tabVideo.style.color = 'white';
                    audioOptions.style.display = 'flex';
                    videoOptions.style.display = 'none';
                };

                const getHumanReadableSize = (size) => {
                    const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
                    let sizeInBytes = parseInt(size);
                    if (isNaN(sizeInBytes)) return "Unknown Size";
                    let i = 0;
                    while (sizeInBytes > 1024 && i < units.length - 1) { sizeInBytes /= 1024; i++; }
                    return `${sizeInBytes.toFixed(2)} ${units[i]}`;
                };

                const selectDemuxer = modalBackdrop.querySelector('#select-demuxer');
                const selectCodec = modalBackdrop.querySelector('#select-codec');
                const selectQuality = modalBackdrop.querySelector('#select-quality');

                const isHlsStream = formats && formats.length > 0 && formats[0].demuxer === 'm3u8';

                if (isHlsStream) {
                    // Hide tabs and other selectors
                    modalBackdrop.querySelector('#tab-video').parentNode.style.display = 'none';
                    selectDemuxer.parentNode.style.display = 'none';
                    selectCodec.parentNode.style.display = 'none';

                    // Populate HLS resolutions directly
                    formats.forEach((fmt, idx) => {
                        const opt = document.createElement('option');
                        opt.value = idx;
                        let optLabel = fmt.resolution || 'unknown';
                        if (fmt.bandwidth) {
                            optLabel += ` (${Math.round(fmt.bandwidth / 1000)} kbps)`;
                        }
                        opt.textContent = optLabel;
                        selectQuality.appendChild(opt);
                    });
                } else {
                    const demuxers = [...new Set(formats.map(fmt => fmt.demuxer))];
                    demuxers.forEach(d => {
                        const opt = document.createElement('option');
                        opt.value = d;
                        opt.textContent = d.toUpperCase();
                        selectDemuxer.appendChild(opt);
                    });

                    function updateCodecDropdown() {
                        selectCodec.innerHTML = '';
                        const selectedDemuxer = selectDemuxer.value;
                        const availableCodecs = [...new Set(formats.filter(fmt => fmt.demuxer === selectedDemuxer).map(fmt => fmt.codec || 'UNKNOWN'))];

                        availableCodecs.forEach(c => {
                            const opt = document.createElement('option');
                            opt.value = c;
                            opt.textContent = c;
                            selectCodec.appendChild(opt);
                        });

                        if (availableCodecs.includes('AV1')) selectCodec.value = 'AV1';
                        else if (availableCodecs.includes('VP9')) selectCodec.value = 'VP9';
                        else if (availableCodecs.includes('H265')) selectCodec.value = 'H265';
                        else if (availableCodecs.includes('H264')) selectCodec.value = 'H264';
                        else selectCodec.value = availableCodecs[0];

                        updateResolutionDropdown();
                    }

                    function updateResolutionDropdown() {
                        selectQuality.innerHTML = '';
                        const selectedDemuxer = selectDemuxer.value;
                        const selectedCodec = selectCodec.value;

                        const availableFormats = formats.filter(fmt =>
                            fmt.demuxer === selectedDemuxer &&
                            (fmt.codec === selectedCodec || (!fmt.codec && selectedCodec === 'UNKNOWN'))
                        );

                        availableFormats.forEach((fmt) => {
                            const opt = document.createElement('option');
                            opt.value = formats.indexOf(fmt);
                            let optLabel = fmt.label || `${fmt.width}x${fmt.height}`;
                            if (fmt.contentLength) {
                                optLabel += ` • ${getHumanReadableSize(fmt.contentLength)}`;
                            }
                            opt.textContent = optLabel;
                            selectQuality.appendChild(opt);
                        });
                    }

                    selectDemuxer.onchange = updateCodecDropdown;
                    selectCodec.onchange = updateResolutionDropdown;

                    if (demuxers.includes('mp4')) {
                        selectDemuxer.value = 'mp4';
                    } else if (demuxers.length > 0) {
                        selectDemuxer.value = demuxers[0];
                    }
                    updateCodecDropdown();
                }

                const btnCancel = modalBackdrop.querySelector('#btn-cancel');
                const btnDownload = modalBackdrop.querySelector('#btn-download');

                btnCancel.onclick = () => modalBackdrop.remove();

                btnDownload.onclick = () => {
                    const selectedIdx = parseInt(selectQuality.value);
                    const fmt = formats[selectedIdx];
                    if (fmt) {
                        if (fmt.demuxer === 'm3u8') {
                            chrome.runtime.sendMessage({
                                action: 'downloadHlsStream',
                                url: fmt.videoUrl,
                                quality: fmt.resolution && fmt.bandwidth ? `${fmt.resolution}@${fmt.bandwidth}` : (fmt.resolution || fmt.bandwidth?.toString() || 'highest'),
                                filename: name
                            });
                        }
                    }
                    modalBackdrop.remove();
                };
            };

            if (!drm) {
                const dlBtn = toast.querySelector('.mdu-toast-dl-btn');
                dlBtn.style.cssText = `
                    background: ${safeColor}; color: ${btnTextColor}; border: none; padding: 8px 18px;
                    border-radius: 18px; cursor: pointer; font-weight: 600; font-size: 13px;
                    transition: all 0.2s ease;
                `;
                dlBtn.onmouseenter = () => { dlBtn.style.filter = 'brightness(1.15)'; dlBtn.style.transform = 'translateY(-1px)'; };
                dlBtn.onmouseleave = () => { dlBtn.style.filter = 'brightness(1)'; dlBtn.style.transform = 'translateY(0)'; };
                dlBtn.onmousedown = () => dlBtn.style.transform = 'scale(0.95)';
                dlBtn.onmouseup = () => dlBtn.style.transform = 'scale(1)';
                dlBtn.onclick = () => {
                    if (formats && formats.length > 0) {
                        showQualityModal();
                    } else {
                        chrome.runtime.sendMessage({ action: 'startDownloadFromToast', url: downloadUrl });
                    }
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateX(-50%) translateY(10px) scale(0.95)';
                    setTimeout(() => toast.remove(), 300);
                };
            }

            const progressBar = toast.querySelector('.mdu-toast-progress-bar');
            progressBar.style.cssText = `
                position: absolute; bottom: 0; left: 0; height: 3px;
                background: ${safeColor}; width: 100%; transition: width 6s linear;
                opacity: 0.5;
            `;

            const style = document.createElement('style');
            style.id = 'mdu-toast-style';
            style.textContent = `
                @keyframes mdu-toast-in {
                    from { bottom: -80px; opacity: 0; transform: translateX(-50%) scale(0.9); }
                    to { bottom: 24px; opacity: 1; transform: translateX(-50%) scale(1); }
                }
            `;
            if (!document.getElementById('mdu-toast-style')) document.head.appendChild(style);

            // Swipe / Drag dismiss logic
            let isDragging = false;
            let startX = 0;
            let startY = 0;
            let diffX = 0;
            let diffY = 0;

            const handleStart = (clientX, clientY) => {
                isDragging = true;
                startX = clientX;
                startY = clientY;
                toast.style.transition = 'none';
            };

            const handleMove = (clientX, clientY) => {
                if (!isDragging) return;
                diffX = clientX - startX;
                diffY = clientY - startY;
                const dragDist = Math.sqrt(diffX * diffX + diffY * diffY);
                const dragOpacity = Math.max(0, 1 - dragDist / 150);
                toast.style.transform = `translateX(calc(-50% + ${diffX}px)) translateY(${diffY}px)`;
                toast.style.opacity = dragOpacity;
            };

            const handleEnd = () => {
                if (!isDragging) return;
                isDragging = false;
                toast.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                if (Math.abs(diffX) > 80 || Math.abs(diffY) > 80) {
                    let endTransform;
                    if (Math.abs(diffX) >= Math.abs(diffY)) {
                        const slideDir = diffX > 0 ? 200 : -200;
                        endTransform = `translateX(calc(-50% + ${slideDir}px))`;
                    } else {
                        const slideDir = diffY > 0 ? 200 : -200;
                        endTransform = `translateX(-50%) translateY(${slideDir}px)`;
                    }
                    toast.style.transform = endTransform;
                    toast.style.opacity = '0';
                    setTimeout(() => {
                        if (toast.parentNode) toast.remove();
                    }, 300);
                } else {
                    toast.style.transform = 'translateX(-50%)';
                    toast.style.opacity = '1';
                }
                diffX = 0;
                diffY = 0;
            };

            const isInteractiveTarget = (target) => {
                return target.tagName === 'BUTTON' || target.tagName === 'SELECT' || target.closest('button') || target.closest('select');
            };

            toast.addEventListener('touchstart', (e) => {
                if (isInteractiveTarget(e.target)) return;
                const t = e.touches[0];
                handleStart(t.clientX, t.clientY);
            }, { passive: true });

            toast.addEventListener('touchmove', (e) => {
                const t = e.touches[0];
                handleMove(t.clientX, t.clientY);
            }, { passive: true });

            toast.addEventListener('touchend', handleEnd, { passive: true });

            toast.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (isInteractiveTarget(e.target)) {
                    return;
                }
                handleStart(e.clientX, e.clientY);

                const onMouseMove = (moveEvt) => {
                    handleMove(moveEvt.clientX, moveEvt.clientY);
                };

                const onMouseUp = () => {
                    handleEnd();
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            document.body.appendChild(toast);

            setTimeout(() => { progressBar.style.width = '0%'; }, 10);
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateX(-50%) translateY(10px) scale(0.95)';
                    setTimeout(() => toast.remove(), 300);
                }
            }, 6000);
        },
        args: [filename, url, browser.i18n.getMessage("mediaNotificationDownloadAction") || "Download", mediaType, title, themeColor, isDrm, hlsFormats, stackNotifications, modalTranslations, uiScale]
    }).catch(() => {});
}
