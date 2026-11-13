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


async function reauthDropbox() {
    return new Promise((resolve, reject) => {
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
            const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;
            const authUrl = "https://www.dropbox.com/oauth2/authorize?client_id=" + clientId + "&response_type=token&redirect_uri=" + encodeURIComponent(finalRedirectUri);

            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                browser.identity.launchWebAuthFlow({ url: authUrl, interactive: false }).then(redirectUrl => {
                    if (redirectUrl) {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                        if (accessToken) {
                            browser.storage.local.set({ 'dropbox_token': accessToken }).then(() => resolve(accessToken));
                        } else {
                            reject(new Error("No access token found"));
                        }
                    } else reject(new Error("No redirect URL"));
                }).catch(e => reject(e));
            } else {
                let isResolved = false;
                let authTabId = null;
                const updatedListener = async (tabId, changeInfo, tab) => {
                    const urlString = changeInfo.url || tab.url;
                    if (urlString && urlString.includes(normalizedRedirectUri) && (urlString.includes('access_token=') || urlString.includes('error='))) {
                        if (!isResolved) {
                            isResolved = true;
                            browser.tabs.remove(tabId).catch(() => {});
                            cleanup();
                            const url = new URL(urlString);
                            const hashParams = new URLSearchParams(url.hash.substring(1));
                            const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                            if (accessToken) browser.storage.local.set({ 'dropbox_token': accessToken }).then(() => resolve(accessToken));
                            else reject(new Error("Failed to reauth Dropbox"));
                        }
                    }
                };
                const removedListener = (tabId) => {
                    if (authTabId && tabId === authTabId && !isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(new Error("Reauth tab closed"));
                    }
                };
                const cleanup = () => {
                    browser.tabs.onUpdated.removeListener(updatedListener);
                    browser.tabs.onRemoved.removeListener(removedListener);
                };
                browser.tabs.onUpdated.addListener(updatedListener);
                browser.tabs.onRemoved.addListener(removedListener);
                browser.tabs.create({ url: authUrl, active: false }).then(tab => { authTabId = tab.id; }).catch(e => {
                    if (!isResolved) { isResolved = true; cleanup(); reject(e); }
                });
            }
        } catch (e) { reject(e); }
    });
}

async function reauthGDrive() {
    return new Promise((resolve, reject) => {
        try {
            const clientId = "1042907477337-c8h27qniercjia05jqqafgvjao514n28.apps.googleusercontent.com";

            let finalRedirectUri;
            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.getRedirectURL === 'function') {
                finalRedirectUri = browser.identity.getRedirectURL();
            } else {
                const id = browser.runtime.id;
                if (id && id.includes('@')) {
                    finalRedirectUri = `https://${encodeURIComponent(id)}.extensions.allizom.org/`;
                } else {
                    finalRedirectUri = "https://924f7c81-8b1e-4b6e-9e7c-8e4a9e1d2c3f.extensions.allizom.org/";
                }
            }

            const scope = encodeURIComponent("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email");
            const normalizedRedirectUri = finalRedirectUri.endsWith('/') ? finalRedirectUri.slice(0, -1) : finalRedirectUri;

            const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(finalRedirectUri)}&scope=${scope}&prompt=none`;

            if (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function') {
                browser.identity.launchWebAuthFlow({
                    url: authUrl,
                    interactive: false
                }).then(async (redirectUrl) => {
                    if (redirectUrl) {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
                        if (accessToken) {
                            await browser.storage.local.set({ 'gdrive_token': accessToken });
                            resolve(accessToken);
                        } else {
                            reject(new Error("No access token in redirect URL"));
                        }
                    } else {
                        reject(new Error("No redirect URL"));
                    }
                }).catch(e => {
                    reject(e);
                });
            } else {
                let isResolved = false;
                let authTabId = null;

                const updatedListener = async (tabId, changeInfo, tab) => {
                    const urlString = changeInfo.url || tab.url;
                    if (urlString && urlString.includes(normalizedRedirectUri) && (urlString.includes('access_token=') || urlString.includes('error='))) {
                        if (!isResolved) {
                            isResolved = true;
                            browser.tabs.remove(tabId).catch(() => {});
                            cleanup();

                            const url = new URL(urlString);
                            const hashParams = new URLSearchParams(url.hash.substring(1));
                            const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');

                            if (accessToken) {
                                await browser.storage.local.set({ 'gdrive_token': accessToken });
                                resolve(accessToken);
                            } else {
                                reject(new Error("Failed to reauth: " + (hashParams.get('error') || "No access token")));
                            }
                        }
                    }
                };

                const removedListener = (tabId) => {
                    if (authTabId && tabId === authTabId && !isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(new Error("Reauth tab closed"));
                    }
                };

                const cleanup = () => {
                    browser.tabs.onUpdated.removeListener(updatedListener);
                    browser.tabs.onRemoved.removeListener(removedListener);
                };

                browser.tabs.onUpdated.addListener(updatedListener);
                browser.tabs.onRemoved.addListener(removedListener);

                browser.tabs.create({ url: authUrl, active: false }).then(tab => {
                    authTabId = tab.id;
                }).catch(e => {
                    if (!isResolved) {
                        isResolved = true;
                        cleanup();
                        reject(e);
                    }
                });
            }
        } catch (e) {
            reject(e);
        }
    });
}
