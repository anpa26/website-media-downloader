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



async function generateTemplateName(template, url, originalName, suggestedTitle) {
    return mediaFilename.template(template, url, originalName, suggestedTitle);
}

function showRenameDialog(initialValue) {
    return new Promise(async (resolve) => {
        const settings = await browser.storage.local.get('disable-rename-dialog');
        const isAlreadyDisabled = settings['disable-rename-dialog'] === '1';

        const dialog = document.createElement('mdui-dialog');
        dialog.headline = browser.i18n.getMessage("renameDialogHeadline") || "Download as...";

        const textField = document.createElement('mdui-text-field');
        textField.value = initialValue;
        textField.style.marginTop = '16px';
        textField.setAttribute('label', browser.i18n.getMessage("renameDialogLabel") || "Filename");
        dialog.appendChild(textField);

        let checkbox = null;
        if (!isAlreadyDisabled) {
            const checkboxContainer = document.createElement('div');
            checkboxContainer.style.marginTop = '12px';
            checkboxContainer.style.display = 'flex';
            checkboxContainer.style.alignItems = 'center';

            checkbox = document.createElement('mdui-checkbox');
            checkbox.textContent = browser.i18n.getMessage("dontShowRenameDialogCheckbox") || "Don't show this again";
            checkboxContainer.appendChild(checkbox);
            dialog.appendChild(checkboxContainer);
        }

        const cancelBtn = document.createElement('mdui-button');
        cancelBtn.slot = "action";
        cancelBtn.variant = "text";
        cancelBtn.textContent = browser.i18n.getMessage("renameDialogCancelButton") || "Cancel";
        cancelBtn.addEventListener('click', () => {
            dialog.open = false;
            resolve(null);
        });

        const okBtn = document.createElement('mdui-button');
        okBtn.slot = "action";
        okBtn.variant = "tonal";
        okBtn.textContent = browser.i18n.getMessage("renameDialogDownloadButton") || "Download";
        okBtn.addEventListener('click', () => {
            if (checkbox && checkbox.checked) {
                browser.storage.local.set({ 'disable-rename-dialog': '1' });

                const settingsSwitch = document.getElementById('disable-rename-dialog');
                if (settingsSwitch) {
                    settingsSwitch.checked = true;
                }
            }
            dialog.open = false;
            resolve(textField.value);
        });

        dialog.appendChild(cancelBtn);
        dialog.appendChild(okBtn);
        document.body.appendChild(dialog);

        dialog.open = true;

        dialog.addEventListener('closed', () => {
            dialog.remove();
        });
    });
}
