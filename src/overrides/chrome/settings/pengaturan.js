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


async function initializeSettings() {
    isInitializing = true;

    const tempRes = await browser.storage.local.get('filename-template');
    if (tempRes['filename-template'] === '0') {
        await browser.storage.local.set({ 'filename-template': '' });
    }

    const settings = SETTINGS_KEYS;

    const storedSettings = await browser.storage.local.get(settings);
    const defaultSettings = {};
    for (const setting of settings) {
        let value = storedSettings[setting];

        if (value === undefined) {
            const defaultsEnabled = [
                'auto-download-video', 'auto-download-stream', 'auto-ignore-excluded-media',
                'ignore-excluded-media',
                'document-scan', 'url-detection', 'mime-detection', 'hide-page-components', 'hide-segments',
                'media-notification', 'media-system-notification', 'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle',
                'background-download', 'only-file', 'gabung-stream', 'auto-check-update', 'badge-counter',
                'detect-download-links', 'disable-deduplication', 'fetch-notification', 'group-by-type', 'group-download-progress'
            ];
            if (defaultsEnabled.includes(setting)) {
                value = '1';
                defaultSettings[setting] = value;
            } else if (['auto-download-media', 'auto-download-all-domains', 'manual-scan', 'manual-scan-keep-tabs', 'remove-on-tab-close', 'ignore-disabled-types', 'hide-image-without-size', 'history-page', 'save-to-gdrive', 'gdrive-stream', 'save-to-dropbox', 'dropbox-stream', 'stack-notifications', 'embed-subtitles-nonyt', 'mpd-to-mp4', 'block-incoming-popups', 'redirect-guard-hide-content', 'audio-to-mp3'].includes(setting)) {
                value = '0';
                defaultSettings[setting] = value;
            } else if (setting === 'speed-boost' || setting === 'speed-boost-resume' || setting === 'disable-rename-dialog') {
                value = '0';
                defaultSettings[setting] = value;
            } else if (setting === 'connections') {
                value = '4';
                defaultSettings[setting] = value;
            } else if (setting === 'mp3-bitrate') {
                value = '320';
                defaultSettings[setting] = value;
            } else if (setting === 'auto-download-quality') {
                value = 'highest';
                defaultSettings[setting] = value;
            } else if (setting === 'theme-mode') {
                value = 'auto';
                defaultSettings[setting] = value;
            } else if (setting === 'document-scan-mode') {
                value = 'light';
                defaultSettings[setting] = value;
            } else if (setting === 'image-min-side') {
                value = '0';
                defaultSettings[setting] = value;
            } else if (setting === 'image-min-side-custom') {
                value = '512';
                defaultSettings[setting] = value;
            } else if (setting === 'image-min-file-size' || setting === 'image-min-file-size-custom') {
                value = '0';
                defaultSettings[setting] = value;
            }
        }

        const element = document.getElementById(setting);
        if (!element) continue;

        if (element.tagName === 'MDUI-SWITCH') {
            element.checked = value === '1' || value === true;

            if (setting === 'gabung-stream') {
                const itemMp4 = document.getElementById('mpd-to-mp4')?.closest('.setting-item');
                const perbaruiVisibilitasMp4 = () => {
                    if (itemMp4) itemMp4.style.display = element.checked ? 'flex' : 'none';
                };
                perbaruiVisibilitasMp4();
                element.addEventListener('change', perbaruiVisibilitasMp4);
            }

            const updateConstraints = () => {
                const speedBoost = document.getElementById('speed-boost');
                const speedBoostResume = document.getElementById('speed-boost-resume');
                const connections = document.getElementById('connections');
                const gdriveStream = document.getElementById('gdrive-stream');
                const onlyFile = document.getElementById('only-file');

                if (setting === 'document-scan') {
                    const mode = document.getElementById('document-scan-mode');
                    const item = mode?.closest('.setting-item');
                    if (mode) mode.disabled = !element.checked;
                    if (item) item.style.display = element.checked ? 'flex' : 'none';
                }

                if (setting === 'redirect-guard-hide-content') {
                    const clicks = document.getElementById('redirect-guard-clicks');
                    const item = clicks?.closest('.setting-item');
                    if (item) item.style.display = element.checked ? 'none' : 'flex';
                }

                if (setting === 'auto-download-all-domains') {
                    const domainsContainer = document.getElementById('auto-download-domains-container');
                    if (domainsContainer) {
                        domainsContainer.style.display = element.checked ? 'none' : 'block';
                    }
                    const skipDomainsContainer = document.getElementById('auto-skip-download-domains-container');
                    if (skipDomainsContainer) {
                        skipDomainsContainer.style.display = element.checked ? 'block' : 'none';
                    }
                }

                if (setting === 'background-download') {
                    const autoDownload = document.getElementById('auto-download-media');
                    if (autoDownload) {
                        autoDownload.disabled = !element.checked;
                        const autoDownloadExplain = document.getElementById('auto-download-media-explain');
                        if (autoDownloadExplain) {
                            autoDownloadExplain.textContent = element.checked
                                ? (browser.i18n.getMessage('autoDownloadMediaExplain') || 'Automatically download matching media from enabled sites.')
                                : (browser.i18n.getMessage('autoDownloadUnavailableExplain') || 'Auto-download is unavailable because Background download is turned off.');
                        }
                        if (!element.checked && autoDownload.checked) {
                            autoDownload.checked = false;
                            pendingChanges['auto-download-media'] = '0';
                        }
                    }
                }

                if (setting === 'gdrive-stream' || setting === 'dropbox-stream') {
                    if (speedBoost) {
                        if (element.checked) {
                            speedBoost.checked = false;
                            speedBoost.disabled = true;
                            pendingChanges['speed-boost'] = '0';

                            if (speedBoostResume) {
                                speedBoostResume.checked = false;
                                speedBoostResume.disabled = true;
                                const item = speedBoostResume.closest('.setting-item');
                                if (item) item.style.display = 'none';
                                pendingChanges['speed-boost-resume'] = '0';
                            }
                            if (connections) {
                                connections.disabled = true;
                                const item = connections.closest('.setting-item');
                                if (item) item.style.display = 'none';
                            }

                            if (typeof showApplyBar === 'function') showApplyBar();
                        } else {
                            speedBoost.disabled = false;
                            if (speedBoostResume) {
                                speedBoostResume.disabled = !speedBoost.checked;
                                const item = speedBoostResume.closest('.setting-item');
                                if (item) item.style.display = speedBoost.checked ? 'flex' : 'none';
                            }
                            if (connections) {
                                connections.disabled = !speedBoost.checked;
                                const item = connections.closest('.setting-item');
                                if (item) item.style.display = speedBoost.checked ? 'flex' : 'none';
                            }
                        }
                    }
                }

                if (setting === 'speed-boost') {
                    if (!element.checked) {
                        if (speedBoostResume) {
                            speedBoostResume.checked = false;
                            speedBoostResume.disabled = true;
                            const item = speedBoostResume.closest('.setting-item');
                            if (item) item.style.display = 'none';
                            pendingChanges['speed-boost-resume'] = '0';
                        }
                        if (connections) {
                            connections.disabled = true;
                            const item = connections.closest('.setting-item');
                            if (item) item.style.display = 'none';
                        }
                    } else {
                        if (speedBoostResume) {
                            speedBoostResume.disabled = false;
                            const item = speedBoostResume.closest('.setting-item');
                            if (item) item.style.display = 'flex';
                        }
                        if (connections) {
                            connections.disabled = false;
                            const item = connections.closest('.setting-item');
                            if (item) item.style.display = 'flex';
                        }
                    }
                }

                if (setting === 'save-to-gdrive') {
                    if (!element.checked) {
                        if (gdriveStream) {
                            gdriveStream.checked = false;
                            gdriveStream.disabled = true;
                            pendingChanges['gdrive-stream'] = '0';

                            const dbxStream = document.getElementById('dropbox-stream');
                            if (speedBoost && (!dbxStream || !dbxStream.checked)) {
                                speedBoost.disabled = false;
                                if (speedBoostResume) {
                                    speedBoostResume.disabled = !speedBoost.checked;
                                    const item = speedBoostResume.closest('.setting-item');
                                    if (item) item.style.display = speedBoost.checked ? 'flex' : 'none';
                                    if (speedBoostResume.disabled) {
                                        speedBoostResume.checked = false;
                                        pendingChanges['speed-boost-resume'] = '0';
                                    }
                                }
                                if (connections) {
                                    connections.disabled = !speedBoost.checked;
                                    const item = connections.closest('.setting-item');
                                    if (item) item.style.display = speedBoost.checked ? 'flex' : 'none';
                                }
                            }
                        }
                    } else {
                        if (gdriveStream) gdriveStream.disabled = false;
                    }
                }

                if (setting === 'save-to-dropbox') {
                    if (!element.checked) {
                        const dbxStream = document.getElementById('dropbox-stream');
                        if (dbxStream) {
                            dbxStream.checked = false;
                            dbxStream.disabled = true;
                            pendingChanges['dropbox-stream'] = '0';

                            const gdriveStream = document.getElementById('gdrive-stream');
                            const speedBoost = document.getElementById('speed-boost');
                            const speedBoostResume = document.getElementById('speed-boost-resume');
                            const connections = document.getElementById('connections');

                            if (speedBoost && (!gdriveStream || !gdriveStream.checked)) {
                                speedBoost.disabled = false;
                                if (speedBoostResume) {
                                    speedBoostResume.disabled = !speedBoost.checked;
                                    const item = speedBoostResume.closest('.setting-item');
                                    if (item) item.style.display = speedBoost.checked ? 'flex' : 'none';
                                    if (speedBoostResume.disabled) {
                                        speedBoostResume.checked = false;
                                        pendingChanges['speed-boost-resume'] = '0';
                                    }
                                }
                                if (connections) {
                                    connections.disabled = !speedBoost.checked;
                                    const item = connections.closest('.setting-item');
                                    if (item) item.style.display = speedBoost.checked ? 'flex' : 'none';
                                }
                            }
                        }
                    } else {
                        const dbxStream = document.getElementById('dropbox-stream');
                        if (dbxStream) dbxStream.disabled = false;
                    }
                }

                if (setting === 'detect-download-links') {
                    if (onlyFile) {
                        const item = onlyFile.closest('.setting-item');
                        if (item) {
                            item.style.display = element.checked ? 'flex' : 'none';
                            if (!element.checked) {
                                onlyFile.checked = false;
                                pendingChanges['only-file'] = '0';
                            }
                        }
                    }
                }

                if (setting === 'optimize-low-end') {
                    const limitSelect = document.getElementById('limit-media-list');
                    const limitCustom = document.getElementById('limit-media-list-custom');
                    if (element.checked) {
                        if (limitSelect) {
                            if (limitSelect.value !== '10') limitSelect.value = '10';
                            limitSelect.disabled = true;
                            pendingChanges['limit-media-list'] = '10';
                        }
                        if (limitCustom) {
                            limitCustom.disabled = true;
                            const item = limitCustom.closest('.setting-item');
                            if (item) item.style.display = 'none';
                        }
                        const cleanView = document.getElementById('clean-view');
                        if (cleanView && !cleanView.checked) {
                            cleanView.checked = true;
                            cleanView.dispatchEvent(new Event('change'));
                        }
                        try {
                            browser.runtime.sendMessage({ action: 'clearStorage' });
                        } catch(e) {}
                    } else {
                        if (limitSelect) {
                            limitSelect.disabled = false;
                            if (limitSelect.value === 'custom' && limitCustom) {
                                const item = limitCustom.closest('.setting-item');
                                if (item) item.style.display = 'flex';
                                limitCustom.disabled = false;
                            }
                        }
                    }
                }
            };

            if (setting === 'auto-download-all-domains' || setting === 'gdrive-stream' || setting === 'speed-boost' || setting === 'background-download' || setting === 'save-to-gdrive' || setting === 'detect-download-links' || setting === 'optimize-low-end' || setting === 'redirect-guard-hide-content') {
                const checkInitial = () => {
                    const speedBoost = document.getElementById('speed-boost');
                    const speedBoostResume = document.getElementById('speed-boost-resume');
                    const connections = document.getElementById('connections');
                    const gdriveStream = document.getElementById('gdrive-stream');
                    const backgroundDownload = document.getElementById('background-download');
                    const cloudSaveLocation = document.getElementById('cloud-save-location');
                    const detectDownloadLinks = document.getElementById('detect-download-links');
                    const onlyFile = document.getElementById('only-file');
                    const optimizeLowEnd = document.getElementById('optimize-low-end');
                    const limitSelect = document.getElementById('limit-media-list');
                    const limitCustom = document.getElementById('limit-media-list-custom');

                    if (speedBoost && speedBoostResume && connections && gdriveStream && backgroundDownload && cloudSaveLocation && detectDownloadLinks && onlyFile) {
                        const dropboxStream = document.getElementById('dropbox-stream');

                        if (gdriveStream) {
                            gdriveStream.disabled = cloudSaveLocation.value !== 'gdrive';
                            if (gdriveStream.disabled) gdriveStream.checked = false;
                        }
                        if (dropboxStream) {
                            dropboxStream.disabled = cloudSaveLocation.value !== 'dropbox';
                            if (dropboxStream.disabled) dropboxStream.checked = false;
                        }

                        if ((gdriveStream && gdriveStream.checked) || (dropboxStream && dropboxStream.checked)) {
                            speedBoost.checked = false;
                            speedBoost.disabled = true;
                            if (speedBoostResume) {
                                speedBoostResume.checked = false;
                                speedBoostResume.disabled = true;
                                const item = speedBoostResume.closest('.setting-item');
                                if (item) item.style.display = 'none';
                            }
                            if (connections) {
                                connections.disabled = true;
                                const item = connections.closest('.setting-item');
                                if (item) item.style.display = 'none';
                            }
                        } else {
                            speedBoost.disabled = false;
                            if (speedBoostResume) {
                                speedBoostResume.disabled = !speedBoost.checked;
                                if (speedBoostResume.disabled) speedBoostResume.checked = false;
                                const item = speedBoostResume.closest('.setting-item');
                                if (item) item.style.display = speedBoost.checked ? 'flex' : 'none';
                            }
                            if (connections) {
                                connections.disabled = !speedBoost.checked;
                                const item = connections.closest('.setting-item');
                                if (item) item.style.display = speedBoost.checked ? 'flex' : 'none';
                            }
                        }

                        if (onlyFile && detectDownloadLinks) {
                            const item = onlyFile.closest('.setting-item');
                            if (item) {
                                item.style.display = detectDownloadLinks.checked ? 'flex' : 'none';
                                if (!detectDownloadLinks.checked) onlyFile.checked = false;
                            }
                        }

                        if (optimizeLowEnd && limitSelect && limitCustom) {
                            if (optimizeLowEnd.checked) {
                                if (limitSelect.value !== '10') {
                                    limitSelect.value = '10';
                                }
                                limitSelect.disabled = true;
                                limitCustom.disabled = true;
                                const item = limitCustom.closest('.setting-item');
                                if (item) item.style.display = 'none';

                                const ignoreDisabled = document.getElementById('ignore-disabled-types');
                                if (ignoreDisabled && !ignoreDisabled.checked) {
                                    ignoreDisabled.checked = true;
                                    pendingChanges['ignore-disabled-types'] = '1';
                                }
                            }
                        }
                    } else {
                        setTimeout(checkInitial, 100);
                    }
                    updateConstraints();
                };
                checkInitial();
            }

            const handleChange = () => {
                pendingChanges[setting] = element.checked ? '1' : '0';
                if (setting === 'hide-segments') {
                    pendingChanges['hide-page-components'] = element.checked ? '1' : '0';
                }

                updateConstraints();
                showApplyBar();

                if (setting === 'background-download') {
                    syncNotificationSetting(element.checked);
                }


                if (setting === 'gdrive-stream' && element.checked) {
                    const downloadMethod = document.getElementById('download-method');
                    if (downloadMethod && downloadMethod.value === 'browser') {
                        if (typeof mdui !== 'undefined' && mdui.snackbar) {
                            tampilnoNotif((browser.i18n.getMessage("streamUploadMethodWarning") || "Note: Stream Upload works best with 'Fetch' download method."));
                        }
                    }
                }

                if ((setting === 'save-to-dropbox' || setting === 'dropbox-stream') && element.checked) {
                    checkDropboxLogin();
                }

                if ((setting === 'save-to-gdrive' || setting === 'gdrive-stream') && element.checked) {
                    checkGDriveLogin();
    checkDropboxLogin();
                }
            };
            element.addEventListener('change', handleChange);
            continue;
        }

        if (element.tagName === 'TEXTAREA' || element.tagName === 'MDUI-TEXT-FIELD' || (element.tagName === 'INPUT' && (element.type === 'text' || element.type === 'number'))) {
            const defVal = ['limit-media-list-custom', 'image-min-file-size-custom'].includes(setting) ? '0' : (setting === 'image-min-side-custom' ? '512' : '');
            element.value = (value !== undefined && value !== null && value !== '') ? value : defVal;
            element.oninput = () => {
                pendingChanges[setting] = element.value;
                showApplyBar();
            };
            if (setting === 'limit-media-list-custom') {
                element.addEventListener('blur', () => {
                    if (element.value.trim() === '') {
                        element.value = '0';
                        pendingChanges[setting] = '0';
                        if (!isInitializing) showApplyBar();
                    }
                });
            }
            if (setting === 'image-min-side-custom') {
                element.addEventListener('blur', () => {
                    const value = Math.min(10000, Math.max(1, parseInt(element.value, 10) || 512));
                    element.value = String(value);
                    pendingChanges[setting] = element.value;
                    if (!isInitializing) showApplyBar();
                });
            }
            if (setting === 'image-min-file-size-custom') {
                element.addEventListener('blur', () => {
                    if (element.value.trim() === '') {
                        element.value = '0';
                        pendingChanges[setting] = '0';
                        if (!isInitializing) showApplyBar();
                    }
                });
            }
            continue;
        }

        if (element.tagName === 'MDUI-SELECT' || element.tagName === 'SELECT' || element.tagName === 'MDUI-SEGMENTED-BUTTON-GROUP') {
            const defaultValue = setting === 'limit-media-list' ? 'custom' :
                                (setting === 'document-scan-mode' ? 'light' :
                                (setting === 'settings-layout' ? 'tabs-icons' : setting === 'top-header-design' ? 'v1' : setting === 'bottom-bar-design' ? 'v3' :
                                (setting === 'theme-mode' ? 'auto' :
                                (setting === 'open-preference' ? 'popup' :
                                (setting === 'download-method' ? 'fetch' :
                                (setting === 'stream-quality' ? 'highest' :
                                (setting === 'subtitle-conversion' ? 'none' :
                                (setting === 'redirect-guard-clicks' ? '2' :
                                (setting === 'connections' ? '4' :
                                (setting === 'media-sort-order' ? 'newest' :
                                (setting === 'mp3-bitrate' ? '320' :
                                (setting === 'min-file-size' || setting === 'image-min-side' ? '0' :
                                (setting === 'ui-scale' ? '85%' :
                                (setting === 'stream-download' ? 'offline' : 'stream')))))))))))))) ;

            element.value = value || defaultValue;
            element.addEventListener('change', () => {
                pendingChanges[setting] = element.value;
                showApplyBar();
                if (setting === 'theme-mode') {
                    const htmlEl = document.documentElement;
                    htmlEl.classList.remove('mdui-theme-auto', 'mdui-theme-light', 'mdui-theme-dark', 'theme-pitch-black');
                    if (element.value === 'auto') {
                        htmlEl.classList.add('mdui-theme-auto');
                    } else if (element.value === 'light') {
                        htmlEl.classList.add('mdui-theme-light');
                    } else if (element.value === 'dark') {
                        htmlEl.classList.add('mdui-theme-dark');
                    } else if (element.value === 'pitch-black') {
                        htmlEl.classList.add('mdui-theme-dark');
                        htmlEl.classList.add('theme-pitch-black');
                    }
                }
                if (setting === 'limit-media-list') {
                    const limitCustom = document.getElementById('limit-media-list-custom');
                    if (limitCustom) {
                        const item = limitCustom.closest('.setting-item');
                        if (item) item.style.display = element.value === 'custom' ? 'flex' : 'none';
                    }
                }
                if (setting === 'min-file-size') {
                    const minCustom = document.getElementById('min-file-size-custom');
                    if (minCustom) {
                        const item = minCustom.closest('.setting-item');
                        if (item) item.style.display = element.value === 'custom' ? 'flex' : 'none';
                    }
                }
                if (setting === 'image-min-file-size') {
                    const imageFileSizeCustom = document.getElementById('setting-image-min-file-size-custom');
                    if (imageFileSizeCustom) imageFileSizeCustom.style.display = element.value === 'custom' ? 'flex' : 'none';
                }
                if (setting === 'image-min-side') {
                    const custom = document.getElementById('setting-image-min-side-custom');
                    if (custom) custom.style.display = element.value === 'custom' ? 'flex' : 'none';
                }
                if (setting === 'settings-layout') {
                    applySettingsLayout(element.value);
                }
                if (setting === 'ui-scale') {
                    const scaleCustom = document.getElementById('setting-ui-scale-custom');
                    if (scaleCustom) {
                        scaleCustom.style.display = element.value === 'custom' ? 'flex' : 'none';
                    }
                    if (element.value === 'custom') {
                        const customVal = document.getElementById('ui-scale-custom')?.value || '80';
                        document.documentElement.style.zoom = customVal + '%';
                        pendingChanges['ui-scale'] = customVal + '%';
                    } else {
                        document.documentElement.style.zoom = element.value;
                    }
                }
                if (setting === 'ui-scale-custom') {
                    const scaleSelect = document.getElementById('ui-scale');
                    if (scaleSelect && scaleSelect.value === 'custom') {
                        document.documentElement.style.zoom = element.value + '%';
                        pendingChanges['ui-scale'] = element.value + '%';
                    }
                }
            });
            continue;
        }
    }

    if (Object.keys(defaultSettings).length) {
        await browser.storage.local.set(defaultSettings);
    }

    document.querySelectorAll('select.pill-select').forEach(fitPillSelectToSelectedOption);

    const backgroundDownloadForAuto = document.getElementById('background-download');
    const autoDownloadMediaInitial = document.getElementById('auto-download-media');
    if (backgroundDownloadForAuto && autoDownloadMediaInitial) {
        autoDownloadMediaInitial.disabled = !backgroundDownloadForAuto.checked;
        const autoDownloadExplain = document.getElementById('auto-download-media-explain');
        if (autoDownloadExplain) {
            autoDownloadExplain.textContent = backgroundDownloadForAuto.checked
                ? (browser.i18n.getMessage('autoDownloadMediaExplain') || 'Automatically download matching media from enabled sites.')
                : (browser.i18n.getMessage('autoDownloadUnavailableExplain') || 'Auto-download is unavailable because Background download is turned off.');
        }
        if (!backgroundDownloadForAuto.checked && autoDownloadMediaInitial.checked) {
            autoDownloadMediaInitial.checked = false;
            await browser.storage.local.set({ 'auto-download-media': '0' });
        }
    }

    const scaleSelectInitial = document.getElementById('ui-scale');
    const scaleCustomInitial = document.getElementById('setting-ui-scale-custom');
    if (scaleSelectInitial && scaleCustomInitial) {
        scaleCustomInitial.style.display = scaleSelectInitial.value === 'custom' ? 'flex' : 'none';
    }

    const limitSelectInitial = document.getElementById('limit-media-list');
    const limitCustomInitial = document.getElementById('limit-media-list-custom');
    const optimizeLowEndInitial = document.getElementById('optimize-low-end');
    if (limitSelectInitial && limitCustomInitial) {
        const item = limitCustomInitial.closest('.setting-item');
        if (item) {
            if (limitSelectInitial.value === 'custom' && (!optimizeLowEndInitial || !optimizeLowEndInitial.checked)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        }
    }

    const minSelectInitial = document.getElementById('min-file-size');
    const minCustomInitial = document.getElementById('min-file-size-custom');
    if (minSelectInitial && minCustomInitial) {
        const item = minCustomInitial.closest('.setting-item');
        if (item) {
            item.style.display = minSelectInitial.value === 'custom' ? 'flex' : 'none';
        }
    }

    const imageFileSizeSelectInitial = document.getElementById('image-min-file-size');
    const imageFileSizeCustomInitial = document.getElementById('setting-image-min-file-size-custom');
    if (imageFileSizeSelectInitial && imageFileSizeCustomInitial) {
        imageFileSizeCustomInitial.style.display = imageFileSizeSelectInitial.value === 'custom' ? 'flex' : 'none';
    }

    const imageMinSelectInitial = document.getElementById('image-min-side');
    const imageMinCustomInitial = document.getElementById('setting-image-min-side-custom');
    if (imageMinSelectInitial && imageMinCustomInitial) {
        imageMinCustomInitial.style.display = imageMinSelectInitial.value === 'custom' ? 'flex' : 'none';
    }

    const gdriveBtn = document.getElementById('gdrive-login-btn');
    const gdriveText = document.getElementById('gdrive-login-text');
    const gdriveUserInfo = document.getElementById('gdrive-user-info');
    const gdriveUserEmail = document.getElementById('gdrive-user-email');

    const dropboxBtn = document.getElementById('dropbox-login-btn');
    const dropboxText = document.getElementById('dropbox-login-text');
    const dropboxUserInfo = document.getElementById('dropbox-user-info');
    const dropboxUserEmail = document.getElementById('dropbox-user-email');

    async function checkDropboxLogin() {
        const res = await browser.storage.local.get('dropbox_token');
        const dropboxSwitch = document.getElementById('save-to-dropbox');

        const dropboxSaveContainer = document.getElementById('dropbox-save-container');
        const dropboxStreamContainer = document.getElementById('dropbox-stream-container');

        if (res.dropbox_token) {
            if (dropboxSaveContainer) dropboxSaveContainer.style.display = 'flex';
            if (dropboxStreamContainer) dropboxStreamContainer.style.display = 'flex';
            dropboxText.textContent = browser.i18n.getMessage("dropboxLogoutButton") || "Logout";
            if (dropboxBtn) dropboxBtn.variant = "outlined";

            const userRes = await browser.storage.local.get('dropbox_user');
            if (userRes.dropbox_user) {
                dropboxUserInfo.style.display = 'block';
                dropboxUserEmail.textContent = userRes.dropbox_user.email;
            }
        } else {
            dropboxText.textContent = browser.i18n.getMessage("dropboxLoginButton") || "Login";
            if (dropboxBtn) dropboxBtn.variant = "tonal";
            dropboxUserInfo.style.display = 'none';

            if (dropboxSaveContainer) dropboxSaveContainer.style.display = 'none';
            if (dropboxStreamContainer) dropboxStreamContainer.style.display = 'none';

            const current = await browser.storage.local.get('save-to-dropbox');
            if (current['save-to-dropbox'] === '1' || pendingChanges['save-to-dropbox'] === '1') {
                pendingChanges['save-to-dropbox'] = '0';
                await browser.storage.local.set({ 'save-to-dropbox': '0' });

                const select = document.getElementById('cloud-save-location');
                if (select && select.value === 'dropbox') {
                    select.value = 'local';
                    select.dispatchEvent(new Event('change'));
                }
                const dropboxDetails = document.getElementById('dropbox-details-container');
                if (dropboxDetails) dropboxDetails.style.display = 'none';
            }
        }
    }

    async function checkGDriveLogin() {
        const res = await browser.storage.local.get('gdrive_token');
        const gdriveSwitch = document.getElementById('save-to-gdrive');

        const gdriveSaveContainer = document.getElementById('gdrive-save-container');
        const gdriveStreamContainer = document.getElementById('gdrive-stream-container');

        if (res.gdrive_token) {
            if (gdriveSaveContainer) gdriveSaveContainer.style.display = 'flex';
            if (gdriveStreamContainer) gdriveStreamContainer.style.display = 'flex';
            gdriveText.textContent = browser.i18n.getMessage("gdriveLogoutButton") || "Logout";
            gdriveBtn.variant = "outlined";

            const userRes = await browser.storage.local.get('gdrive_user');
            if (userRes.gdrive_user) {
                gdriveUserInfo.style.display = 'block';
                gdriveUserEmail.textContent = userRes.gdrive_user.email;
            }
        } else {
            gdriveText.textContent = browser.i18n.getMessage("gdriveLoginButton") || "Login";
            gdriveBtn.variant = "tonal";
            gdriveUserInfo.style.display = 'none';

            if (gdriveSaveContainer) gdriveSaveContainer.style.display = 'none';
            if (gdriveStreamContainer) gdriveStreamContainer.style.display = 'none';

            const current = await browser.storage.local.get('save-to-gdrive');
            if (current['save-to-gdrive'] === '1' || pendingChanges['save-to-gdrive'] === '1') {
                pendingChanges['save-to-gdrive'] = '0';
                await browser.storage.local.set({ 'save-to-gdrive': '0' });

                const select = document.getElementById('cloud-save-location');
                if (select && select.value === 'gdrive') {
                    select.value = 'local';

                    select.dispatchEvent(new Event('change'));
                }
                const gdriveDetails = document.getElementById('gdrive-details-container');
                if (gdriveDetails) gdriveDetails.style.display = 'none';
            }
        }
    }

    if (gdriveBtn) {
        gdriveBtn.onclick = async () => {
            const res = await browser.storage.local.get('gdrive_token');
            if (res.gdrive_token) {
                await browser.storage.local.remove(['gdrive_token', 'gdrive_user']);
                checkGDriveLogin();
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    tampilnoNotif("Logged out from Google Drive");
                }
            } else {
                let isPopup = window.location.pathname.endsWith('popup.html') && !window.location.search.includes('options=true');

                try {
                    const clientId = "1042907477337-c8h27qniercjia05jqqafgvjao514n28.apps.googleusercontent.com";
                    const finalRedirectUri = getRedirectURL();
                    const scope = encodeURIComponent("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email");
                    const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(finalRedirectUri)}&scope=${scope}&prompt=select_account`;

                    const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;

                    if (isPopup) {
                        await browser.tabs.create({ url: 'pages/popup.html?options=true&startGDrive=true' });
                        window.close();
                        return;
                    }

                    let token = await new Promise((resolve, reject) => {
                        let isResolved = false;
                        let authTabId = null;

                        const updatedListener = async (tabId, changeInfo, tab) => {
                            const urlString = changeInfo.url || tab.url;
                            if (urlString && urlString.includes(normalizedRedirectUri) && urlString.includes('access_token=')) {
                                const url = new URL(urlString);
                                const hashParams = new URLSearchParams(url.hash.substring(1));
                                const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');

                                if (accessToken && !isResolved) {
                                    isResolved = true;
                                    browser.tabs.remove(tabId).catch(() => {});
                                    cleanup();
                                    resolve(accessToken);
                                }
                            }
                        };

                        const removedListener = (tabId) => {
                            if (authTabId && tabId === authTabId && !isResolved) {
                                isResolved = true;
                                cleanup();
                                reject(new Error("Login tab closed by user"));
                            }
                        };

                        const cleanup = () => {
                            browser.tabs.onUpdated.removeListener(updatedListener);
                            browser.tabs.onRemoved.removeListener(removedListener);
                        };

                        browser.tabs.onUpdated.addListener(updatedListener);
                        browser.tabs.onRemoved.addListener(removedListener);

                        if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                            browser.identity.launchWebAuthFlow({
                                url: authUrl,
                                interactive: true
                            }).then(redirectUrl => {
                                if (redirectUrl && !isResolved) {
                                    const url = new URL(redirectUrl);
                                    const hashParams = new URLSearchParams(url.hash.substring(1));
                                    const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                                    if (accessToken) {
                                        isResolved = true;
                                        cleanup();
                                        resolve(accessToken);
                                    }
                                }
                            }).catch(e => {
                                console.log("launchWebAuthFlow error:", e);
                            });
                        } else {
                            browser.tabs.create({ url: authUrl }).then(tab => {
                                authTabId = tab.id;
                            }).catch(e => {
                                console.log("browser.tabs.create error:", e);
                                if (!isResolved) {
                                    isResolved = true;
                                    cleanup();
                                    reject(e);
                                }
                            });
                        }
                    });

                    if (token) {
                        await browser.storage.local.set({ gdrive_token: token });

                        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        const userData = await userResponse.json();
                        await browser.storage.local.set({ gdrive_user: userData });

                        checkGDriveLogin();

                        if (window.location.pathname.endsWith('popup.html') && !window.location.search.includes('options=true')) {
                            await browser.tabs.create({ url: 'pages/popup.html?options=true' });
                            window.close();
                        }

                        if (typeof mdui !== 'undefined' && mdui.snackbar) {
                            tampilnoNotif("Successfully logged in to Google Drive");
                        }
                    }

                } catch (error) {
                    console.error("GDrive Login Error:", error);
                    if (typeof mdui !== 'undefined' && mdui.snackbar) {
                        tampilnoNotif("Login failed: " + error.message);
                    }
                }
            }
        };
        checkGDriveLogin();
    }

    if (dropboxBtn) {
        dropboxBtn.onclick = async () => {
            const res = await browser.storage.local.get('dropbox_token');
            if (res.dropbox_token) {
                await browser.storage.local.remove(['dropbox_token', 'dropbox_user']);
                checkDropboxLogin();
                if (typeof mdui !== 'undefined' && mdui.snackbar) {
                    tampilnoNotif("Logged out from Dropbox");
                }
            } else {
                let isPopup = window.location.pathname.endsWith('popup.html') && !window.location.search.includes('options=true');

                try {
                    const clientId = "gipboqpkook5oaj";
                    let finalRedirectUri;
                    if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
                        finalRedirectUri = browser.identity.getRedirectURL();
                    } else {
                        const id = browser.runtime.id;
                        if (id && id.includes('@')) {
                            finalRedirectUri = "https://" + encodeURIComponent(id) + ".extensions.allizom.org/";
                        } else {
                            finalRedirectUri = "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
                        }
                    }

                    const authUrl = "https://www.dropbox.com/oauth2/authorize?client_id=" + clientId + "&response_type=token&redirect_uri=" + encodeURIComponent(finalRedirectUri);
                    const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;

                    if (isPopup) {
                        await browser.tabs.create({ url: 'pages/popup.html?options=true&startDropbox=true' });
                        window.close();
                        return;
                    }

                    let token = await new Promise((resolve, reject) => {
                        let isResolved = false;
                        let authTabId = null;

                        const updatedListener = async (tabId, changeInfo, tab) => {
                            const urlString = changeInfo.url || tab.url;
                            if (urlString && urlString.includes(normalizedRedirectUri) && urlString.includes('access_token=')) {
                                const url = new URL(urlString);
                                const hashParams = new URLSearchParams(url.hash.substring(1));
                                const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');

                                if (accessToken && !isResolved) {
                                    isResolved = true;
                                    browser.tabs.remove(tabId).catch(() => {});
                                    cleanup();
                                    resolve(accessToken);
                                }
                            }
                        };

                        const removedListener = (tabId) => {
                            if (authTabId && tabId === authTabId && !isResolved) {
                                isResolved = true;
                                cleanup();
                                reject(new Error("Login tab closed by user"));
                            }
                        };

                        const cleanup = () => {
                            browser.tabs.onUpdated.removeListener(updatedListener);
                            browser.tabs.onRemoved.removeListener(removedListener);
                        };

                        browser.tabs.onUpdated.addListener(updatedListener);
                        browser.tabs.onRemoved.addListener(removedListener);

                        if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                            browser.identity.launchWebAuthFlow({
                                url: authUrl,
                                interactive: true
                            }).then(redirectUrl => {
                                if (redirectUrl && !isResolved) {
                                    const url = new URL(redirectUrl);
                                    const hashParams = new URLSearchParams(url.hash.substring(1));
                                    const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                                    if (accessToken) {
                                        isResolved = true;
                                        cleanup();
                                        resolve(accessToken);
                                    }
                                }
                            }).catch(e => {
                                console.log("launchWebAuthFlow error:", e);
                            });
                        } else {
                            browser.tabs.create({ url: authUrl }).then(tab => {
                                authTabId = tab.id;
                            }).catch(e => {
                                console.log("browser.tabs.create error:", e);
                                if (!isResolved) {
                                    isResolved = true;
                                    cleanup();
                                    reject(e);
                                }
                            });
                        }
                    });

                    if (token) {
                        await browser.storage.local.set({ dropbox_token: token });

                        const userResponse = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
                            method: 'POST',
                            headers: { 'Authorization': "Bearer " + token }
                        });
                        if (userResponse.ok) {
                            const userData = await userResponse.json();
                            await browser.storage.local.set({ dropbox_user: { email: userData.email, name: userData.name.display_name } });
                        }

                        checkDropboxLogin();

                        if (typeof mdui !== 'undefined' && mdui.snackbar) {
                            tampilnoNotif("Successfully logged in to Dropbox!");
                        }
                    }
                } catch (e) {
                    console.error("Dropbox Login Error", e);
                    if (typeof mdui !== 'undefined' && mdui.snackbar) {
                        tampilnoNotif("Login failed: " + e.message);
                    }
                }
            }
        };
        checkDropboxLogin();
    }

    const layoutResult = await browser.storage.local.get('settings-layout');
    let layoutVal = layoutResult['settings-layout'] || 'tabs-icons';
    if (!layoutResult['settings-layout']) {
        const cleanViewResult = await browser.storage.local.get('clean-view');
        if (cleanViewResult['clean-view'] === '1') {
            layoutVal = 'clean';
        }
    }
    applySettingsLayout(layoutVal);

    setupCollapsibleLogic();

    const colorResult = await browser.storage.local.get('theme-color');

    const autoGenBtn = document.getElementById('auto-generate-template');
    const filenameInput = document.getElementById('filename-template');
    const disableRenameSwitch = document.getElementById('disable-rename-dialog');

    const updateDisableRenameState = () => {

        if (disableRenameSwitch) {
            disableRenameSwitch.disabled = false;
        }
    };

    if (filenameInput) {
        filenameInput.addEventListener('input', updateDisableRenameState);

        setTimeout(updateDisableRenameState, 100);
    }

    if (autoGenBtn && filenameInput) {
        autoGenBtn.onclick = () => {
            const defaultTemplate = "{title} - {name}";
            filenameInput.value = defaultTemplate;
            pendingChanges['filename-template'] = defaultTemplate;
            showApplyBar();
            updateDisableRenameState();

            if (typeof mdui !== 'undefined' && mdui.snackbar) {
                tampilnoNotif(browser.i18n.getMessage("settingsTemplateAutoGenerated", [defaultTemplate]));
            }
        };
    }

    const colorWheel = document.getElementById('theme-color-wheel');
    const brightnessInput = document.getElementById('theme-color-brightness');
    const hexInput = document.getElementById('color-hex-input');

    const hsvToRgb = (h, s, v) => {
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        let rgb = [c, x, 0];
        if (h < 60) rgb = [c, x, 0];
        else if (h < 120) rgb = [x, c, 0];
        else if (h < 180) rgb = [0, c, x];
        else if (h < 240) rgb = [0, x, c];
        else if (h < 300) rgb = [x, 0, c];
        else rgb = [c, 0, x];
        return rgb.map(channel => Math.round((channel + m) * 255));
    };
    const hsvToHex = (h, s, v) => '#' + hsvToRgb(h, s, v)
        .map(channel => channel.toString(16).padStart(2, '0')).join('');
    const hexToHsv = (color) => {
        let hex = color.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(char => char + char).join('');
        if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
        const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        let h = 0;
        if (delta) {
            if (max === r) h = 60 * (((g - b) / delta) % 6);
            else if (max === g) h = 60 * ((b - r) / delta + 2);
            else h = 60 * ((r - g) / delta + 4);
        }
        return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max };
    };

    const activeColor = colorResult['theme-color'] || '#bbdefb';
    let selectedHsv = hexToHsv(activeColor) || hexToHsv('#bbdefb');
    let baseSaturation = selectedHsv.s;
    mdui.setColorScheme(activeColor);
    if (hexInput) hexInput.value = activeColor;
    if (brightnessInput) brightnessInput.value = Math.round(selectedHsv.v * 100);

    const drawColorWheel = () => {
        if (!colorWheel) return;
        const context = colorWheel.getContext('2d');
        const size = colorWheel.width;
        const radius = size / 2;
        const image = context.createImageData(size, size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x + 0.5 - radius;
                const dy = y + 0.5 - radius;
                const saturation = Math.sqrt(dx * dx + dy * dy) / radius;
                const offset = (y * size + x) * 4;
                if (saturation > 1) {
                    image.data[offset + 3] = 0;
                    continue;
                }
                const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
                const [r, g, b] = hsvToRgb(hue, saturation, 1);
                image.data.set([r, g, b, 255], offset);
            }
        }
        context.putImageData(image, 0, 0);
        const angle = selectedHsv.h * Math.PI / 180;
        const markerS = Math.min(selectedHsv.s, (radius - 8) / radius);
        const markerX = radius + Math.cos(angle) * markerS * radius;
        const markerY = radius + Math.sin(angle) * markerS * radius;
        context.beginPath();
        context.arc(markerX, markerY, 6, 0, Math.PI * 2);
        context.lineWidth = 3;
        context.strokeStyle = selectedHsv.s < 0.35 ? '#000000' : '#ffffff';
        context.stroke();
        if (brightnessInput) {
            const brightColor = hsvToHex(selectedHsv.h, selectedHsv.s, 1);
            const darkColor = hsvToHex(selectedHsv.h, selectedHsv.s, 0.15);
            brightnessInput.style.background = `linear-gradient(to right, ${darkColor}, ${brightColor})`;
            brightnessInput.style.setProperty('--brightness-thumb-color', hsvToHex(selectedHsv.h, selectedHsv.s, selectedHsv.v));
        }
    };

    const stageWheelColor = () => {
        const color = hsvToHex(selectedHsv.h, selectedHsv.s, selectedHsv.v);
        pendingChanges['theme-color'] = color;
        showApplyBar();
        mdui.setColorScheme(color);
        if (hexInput) hexInput.value = color.toUpperCase();
        drawColorWheel();
    };

    const updateWheelFromPointer = (event) => {
        if (!colorWheel) return;
        const rect = colorWheel.getBoundingClientRect();
        const dx = (event.clientX - rect.left) / rect.width * colorWheel.width - colorWheel.width / 2;
        const dy = (event.clientY - rect.top) / rect.height * colorWheel.height - colorWheel.height / 2;
        const radius = colorWheel.width / 2;
        selectedHsv.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        selectedHsv.s = Math.min(1, Math.sqrt(dx * dx + dy * dy) / radius);
        baseSaturation = selectedHsv.s;
        stageWheelColor();
    };

    if (colorWheel) {
        colorWheel.addEventListener('pointerdown', event => {
            colorWheel.setPointerCapture(event.pointerId);
            updateWheelFromPointer(event);
        });
        colorWheel.addEventListener('pointermove', event => {
            if (colorWheel.hasPointerCapture(event.pointerId)) updateWheelFromPointer(event);
        });
    }

    if (brightnessInput) {
        brightnessInput.oninput = event => {
            selectedHsv.v = Number(event.target.value) / 100;
            selectedHsv.s = Math.min(1, baseSaturation * (1 + (1 - selectedHsv.v)));
            stageWheelColor();
        };
    }

    if (hexInput) {
        hexInput.oninput = event => {
            let value = event.target.value.trim();
            if (value && !value.startsWith('#')) value = '#' + value;
            pendingChanges['theme-color'] = value;
            showApplyBar();
            const hsv = hexToHsv(value);
            if (hsv) {
                selectedHsv = hsv;
                baseSaturation = selectedHsv.s;
                if (brightnessInput) brightnessInput.value = Math.round(hsv.v * 100);
                mdui.setColorScheme(value);
                drawColorWheel();
            }
        };
    }
    drawColorWheel();

    const bgDlSwitch = document.getElementById('background-download');
    if (bgDlSwitch) {
        syncNotificationSetting(bgDlSwitch.checked);
    }

    setTimeout(() => {
        isInitializing = false;
        pendingChanges = {};
    }, 500);
}
