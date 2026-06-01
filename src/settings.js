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

const getRedirectURL = () => {
    if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
        return browser.identity.getRedirectURL();
    }
    const id = browser.runtime.id;
    if (id && id.includes('@')) {
        return `https://${encodeURIComponent(id)}.extensions.allizom.org/`;
    }
    return "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
};

document.addEventListener('DOMContentLoaded', async () => {
    await Promise.allSettled([
        customElements.whenDefined('mdui-switch'),
        customElements.whenDefined('mdui-segmented-button-group'),
        customElements.whenDefined('mdui-segmented-button')
    ]);
    await initializeSettings();
    setupConfirmationBar();

    if (window.location.search.includes('startGDrive=true')) {
        const res = await browser.storage.local.get('gdrive_token');
        if (!res.gdrive_token) {
            const gdriveBtn = document.getElementById('gdrive-login-btn');
            if (gdriveBtn) gdriveBtn.click();
        }
    }
});

let pendingChanges = {};

function setupConfirmationBar() {
    const bar = document.getElementById('settings-apply-bar');
    const applyBtn = document.getElementById('apply-settings');
    const cancelBtn = document.getElementById('cancel-settings');

    if (!bar || !applyBtn || !cancelBtn) return;

    applyBtn.addEventListener('click', async () => {
        if (Object.keys(pendingChanges).length === 0) return;

        const navbar = document.getElementById('navbar');
        if (navbar && typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('activeTab', navbar.value);
            sessionStorage.setItem('scrollPos', window.scrollY);
        }

        await browser.storage.local.set(pendingChanges);

        location.reload();
    });

    cancelBtn.addEventListener('click', () => {
        pendingChanges = {};
        bar.style.display = 'none';
        initializeSettings(); 
    });
}

function showApplyBar() {
    const bar = document.getElementById('settings-apply-bar');
    if (bar) bar.style.display = 'flex';
}

async function initializeSettings() {
    const settings = [
        'url-detection', 'mime-detection', 'detect-download-links', 'hide-segments', 'hide-page-components',
        'only-video', 'only-audio', 'only-stream', 'only-image', 'only-subtitle', 'only-file',
        'media-notification', 'download-method', 'media-cache', 'speed-boost', 'speed-boost-resume', 'connections', 'stream-download',
        'stream-quality', 'mpd-fix', 'background-download', 'auto-resume', 'stream-to-mp4', 'audio-to-mp3', 'open-preference',
        'filename-template', 'disable-rename-dialog', 'history-page', 'clean-view', 'save-to-gdrive', 'gdrive-stream'
    ];

    for (const setting of settings) {
        const result = await browser.storage.local.get(setting);
        let value = result[setting];

        if (value === undefined) {
            const defaultsEnabled = [
                'url-detection', 'mime-detection', 'hide-page-components',
                'media-notification', 'only-video', 'only-audio', 'only-stream',
                'background-download', 'auto-resume', 'only-file', 'stream-to-mp4'
            ];
            if (defaultsEnabled.includes(setting)) {
                value = '1';
                browser.storage.local.set({ [setting]: value });
            }
if (['only-image', 'only-subtitle', 'detect-download-links', 'history-page', 'clean-view', 'audio-to-mp3', 'save-to-gdrive', 'gdrive-stream'].includes(setting)) {
    value = '0';
} else {
                browser.storage.local.set({ [setting]: value });
            }
            if (setting === 'speed-boost' || setting === 'speed-boost-resume' || setting === 'disable-rename-dialog') {
                value = '0';
                browser.storage.local.set({ [setting]: value });
            }
            if (setting === 'connections') {
                value = '4';
                browser.storage.local.set({ [setting]: value });
            }
        }

        const element = document.getElementById(setting);
        if (!element) continue;

        if (element.tagName === 'MDUI-SWITCH') {
            element.checked = value === '1' || value === true;
            
            const updateConstraints = () => {
                const speedBoost = document.getElementById('speed-boost');
                const speedBoostResume = document.getElementById('speed-boost-resume');
                const connections = document.getElementById('connections');
                const autoResume = document.getElementById('auto-resume');
                const gdriveStream = document.getElementById('gdrive-stream');
                const onlyFile = document.getElementById('only-file');

                if (setting === 'gdrive-stream') {
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

                if (setting === 'background-download') {
                    if (!element.checked) {
                        if (autoResume) {
                            autoResume.checked = false;
                            autoResume.disabled = true;
                            pendingChanges['auto-resume'] = '0';
                        }
                    } else {
                        if (autoResume) autoResume.disabled = false;
                    }
                }

                if (setting === 'save-to-gdrive') {
                    if (!element.checked) {
                        if (gdriveStream) {
                            gdriveStream.checked = false;
                            gdriveStream.disabled = true;
                            pendingChanges['gdrive-stream'] = '0';
                            
                            // Also handle the cascade: if gdrive-stream is off, it might re-enable speed-boost
                            if (speedBoost) {
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
            };

            // Initial constraint check
            if (setting === 'gdrive-stream' || setting === 'speed-boost' || setting === 'background-download' || setting === 'save-to-gdrive' || setting === 'detect-download-links') {
                const checkInitial = () => {
                    const speedBoost = document.getElementById('speed-boost');
                    const speedBoostResume = document.getElementById('speed-boost-resume');
                    const connections = document.getElementById('connections');
                    const gdriveStream = document.getElementById('gdrive-stream');
                    const backgroundDownload = document.getElementById('background-download');
                    const autoResume = document.getElementById('auto-resume');
                    const saveToGDrive = document.getElementById('save-to-gdrive');
                    const detectDownloadLinks = document.getElementById('detect-download-links');
                    const onlyFile = document.getElementById('only-file');

                    if (speedBoost && speedBoostResume && connections && gdriveStream && backgroundDownload && autoResume && saveToGDrive && detectDownloadLinks && onlyFile) {
                        if (gdriveStream.checked) {
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

                        if (autoResume) {
                            autoResume.disabled = !backgroundDownload.checked;
                            if (autoResume.disabled) autoResume.checked = false;
                        }
                        if (gdriveStream) {
                            gdriveStream.disabled = !saveToGDrive.checked;
                            if (gdriveStream.disabled) gdriveStream.checked = false;
                        }

                        if (onlyFile && detectDownloadLinks) {
                            const item = onlyFile.closest('.setting-item');
                            if (item) {
                                item.style.display = detectDownloadLinks.checked ? 'flex' : 'none';
                                if (!detectDownloadLinks.checked) onlyFile.checked = false;
                            }
                        }
                    } else {
                        setTimeout(checkInitial, 100);
                    }
                };
                checkInitial();
            }

            const handleChange = () => {
                pendingChanges[setting] = element.checked ? '1' : '0';
                
                updateConstraints();
                showApplyBar();

                if (setting === 'background-download') {
                    syncNotificationSetting(element.checked);
                }

                if (setting === 'gdrive-stream' && element.checked) {
                    const downloadMethod = document.getElementById('download-method');
                    if (downloadMethod && downloadMethod.value === 'browser') {
                        if (typeof mdui !== 'undefined' && mdui.snackbar) {
                            mdui.snackbar({ message: (browser.i18n.getMessage("streamUploadMethodWarning") || "Note: Stream Upload works best with 'Fetch' download method."), placement: "top" });
                        }
                    }
                }

                if ((setting === 'save-to-gdrive' || setting === 'gdrive-stream') && element.checked) {
                    checkGDriveLogin();
                }
            };
            element.addEventListener('change', handleChange);
            continue;
        }

        if (element.tagName === 'MDUI-TEXT-FIELD' || (element.tagName === 'INPUT' && element.type === 'text')) {
            element.value = value || '';
            element.oninput = () => {
                pendingChanges[setting] = element.value;
                showApplyBar();
            };
            continue;
        }

        if (element.tagName === 'MDUI-SELECT' || element.tagName === 'SELECT') {
            const defaultValue = setting === 'open-preference' ? 'tab' :
                                (setting === 'download-method' ? 'browser' :
                                (setting === 'stream-quality' ? 'highest' :
                                (setting === 'connections' ? '4' :
                                (setting === 'stream-download' ? 'offline' : 'stream'))));
            
            element.value = value || defaultValue;
            element.onchange = () => {
                pendingChanges[setting] = element.value;
                showApplyBar();
            };
            continue;
        }
    }

    const gdriveBtn = document.getElementById('gdrive-login-btn');
    const gdriveText = document.getElementById('gdrive-login-text');
    const gdriveUserInfo = document.getElementById('gdrive-user-info');
    const gdriveUserEmail = document.getElementById('gdrive-user-email');

    async function checkGDriveLogin() {
        const res = await browser.storage.local.get('gdrive_token');
        const gdriveSwitch = document.getElementById('save-to-gdrive');

        if (res.gdrive_token) {
            gdriveText.textContent = browser.i18n.getMessage("gdriveLogoutButton") || "Logout";
            gdriveBtn.variant = "outlined";
            
            const userRes = await browser.storage.local.get('gdrive_user');
            if (userRes.gdrive_user) {
                gdriveUserInfo.style.display = 'block';
                gdriveUserEmail.textContent = userRes.gdrive_user.email;
            }

            if (gdriveSwitch) {
                gdriveSwitch.disabled = false;
            }
        } else {
            gdriveText.textContent = browser.i18n.getMessage("gdriveLoginButton") || "Login";
            gdriveBtn.variant = "tonal";
            gdriveUserInfo.style.display = 'none';

            if (gdriveSwitch) {
                gdriveSwitch.checked = false;
                gdriveSwitch.disabled = true;
                
                const current = await browser.storage.local.get('save-to-gdrive');
                if (current['save-to-gdrive'] === '1') {
                    await browser.storage.local.set({ 'save-to-gdrive': '0' });
                }
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
                    mdui.snackbar({ message: "Logged out from Google Drive", placement: "top" });
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
                        await browser.tabs.create({ url: 'popup.html?options=true&startGDrive=true' });
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
                            await browser.tabs.create({ url: 'popup.html?options=true' });
                            window.close();
                        }

                        if (typeof mdui !== 'undefined' && mdui.snackbar) {
                            mdui.snackbar({ message: "Successfully logged in to Google Drive", placement: "top" });
                        }
                    }

                } catch (error) {
                    console.error("GDrive Login Error:", error);
                    if (typeof mdui !== 'undefined' && mdui.snackbar) {
                        mdui.snackbar({ message: "Login failed: " + error.message, placement: "top" });
                    }
                }
            }
        };
        checkGDriveLogin();
    }

    const cleanViewResult = await browser.storage.local.get('clean-view');
    updateCleanViewUI(cleanViewResult['clean-view'] === '1');

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
                mdui.snackbar({
                    message: browser.i18n.getMessage("settingsTemplateAutoGenerated", [defaultTemplate]),
                    placement: "top"
                });
            }
        };
    }

    const presets = document.querySelectorAll('.color-preset');
    const hexInput = document.getElementById('color-hex-input');
    const openSettingsTabBtn = document.getElementById('open-settings-tab');

    const activeColor = colorResult['theme-color'] || '#bbdefb';
    mdui.setColorScheme(activeColor);
    if (hexInput) hexInput.value = activeColor;

    const updateActivePreset = (color) => {
        presets.forEach(p => {
            if (p.dataset.color && p.dataset.color.toLowerCase() === color.toLowerCase()) {
                p.classList.add('active');
            } else {
                p.classList.remove('active');
            }
        });
    };
    updateActivePreset(activeColor);

    const stageColor = (newColor) => {
        pendingChanges['theme-color'] = newColor;
        showApplyBar();
        mdui.setColorScheme(newColor);
        updateActivePreset(newColor);
    };

    if (hexInput) {
        hexInput.oninput = (e) => {
            let val = e.target.value;
            
            pendingChanges['theme-color'] = val;
            showApplyBar();

            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                mdui.setColorScheme(val);
                updateActivePreset(val);
            }
        };
    }

    presets.forEach(preset => {
        preset.onclick = () => {
            const color = preset.dataset.color;
            if (color) {
                if (hexInput) hexInput.value = color;
                stageColor(color);
            }
        };
    });

    if (openSettingsTabBtn) {
        openSettingsTabBtn.addEventListener('click', () => {
            browser.tabs.create({ url: 'popup.html?options=true' });
        });
    }

    const bgDlSwitch = document.getElementById('background-download');
    if (bgDlSwitch) {
        syncNotificationSetting(bgDlSwitch.checked);
    }
}

function syncNotificationSetting(isBgEnabled) {
    const notificationSwitch = document.getElementById('media-notification');
    if (!notificationSwitch) return;

    if (!isBgEnabled) {

        notificationSwitch.checked = false;
        notificationSwitch.disabled = true;
        browser.storage.local.set({ 'media-notification': '0' });
    } else {

        notificationSwitch.disabled = false;
    }
}

function updatePopupState(value) {
    if (value === 'popup') {
        browser.action.setPopup({ popup: 'popup.html' });
    } else {
        browser.action.setPopup({ popup: '' });
    }
}

function updateCleanViewUI(isEnabled) {
    const container = document.getElementById('settings-container');
    const groups = document.querySelectorAll('.settings-group');
    const icons = document.querySelectorAll('.collapse-icon');
    
    if (container) {
        if (isEnabled) container.classList.add('clean-view-enabled');
        else container.classList.remove('clean-view-enabled');
    }

    groups.forEach(group => {
        if (isEnabled) {
            group.classList.add('collapsed');
            
        } else {
            group.classList.remove('collapsed');
        }
    });

    icons.forEach(icon => {
        icon.style.display = isEnabled ? 'block' : 'none';
    });
}

function setupCollapsibleLogic() {
    const headers = document.querySelectorAll('.collapsible-header');
    
    headers.forEach(header => {
        header.onclick = async () => {
            const cleanViewResult = await browser.storage.local.get('clean-view');
            if (cleanViewResult['clean-view'] !== '1') return;

            const currentGroup = header.closest('.settings-group');
            if (!currentGroup) return;

            const isCurrentlyCollapsed = currentGroup.classList.contains('collapsed');

            document.querySelectorAll('.settings-group').forEach(group => {
                group.classList.add('collapsed');
            });

            if (isCurrentlyCollapsed) {
                currentGroup.classList.remove('collapsed');
            }
        };
    });
}
