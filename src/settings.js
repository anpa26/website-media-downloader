if (typeof browser === 'undefined') {
    var browser = chrome;
}

document.addEventListener('DOMContentLoaded', async () => {
    await Promise.allSettled([
        customElements.whenDefined('mdui-switch'),
        customElements.whenDefined('mdui-segmented-button-group'),
        customElements.whenDefined('mdui-segmented-button')
    ]);
    initializeSettings();
});

async function initializeSettings() {
    const settings = [
        'url-detection', 'mime-detection', 'hide-segments',
        'download-method', 'media-cache', 'stream-download',
        'stream-quality', 'mpd-fix', 'open-preference'
    ];

    for (const setting of settings) {
        const result = await browser.storage.local.get(setting);
        const value = result[setting];

        const switchElement = document.getElementById(setting);
        if (switchElement && switchElement.tagName === 'MDUI-SWITCH') {
            switchElement.checked = value === '1' || value === true;
            switchElement.addEventListener('change', () => {
                browser.storage.local.set({ [setting]: switchElement.checked ? '1' : '0' });
            });
            continue;
        }

        const group = document.getElementById(setting + '-group');
        if (group) {
            const defaultValue = setting === 'open-preference' ? 'tab' : 
                                (setting === 'download-method' ? 'browser' : 
                                (setting === 'stream-quality' ? 'highest' : 'stream'));
            const activeValue = value || defaultValue;
            
            // Atur nilai grup
            group.value = activeValue;
            
            // Fungsi untuk update tampilan selected secara manual
            const updateSelection = (val) => {
                const buttons = group.querySelectorAll('mdui-segmented-button');
                buttons.forEach(btn => {
                    if (btn.value === val) {
                        btn.setAttribute('selected', '');
                        btn.selected = true;
                    } else {
                        btn.removeAttribute('selected');
                        btn.selected = false;
                    }
                });
            };

            // Jalankan sinkronisasi awal
            setTimeout(() => updateSelection(activeValue), 50);

            // Gunakan 'change' event untuk menangkap perubahan klik tunggal
            group.addEventListener('change', () => {
                const newVal = group.value;
                if (newVal) {
                    browser.storage.local.set({ [setting]: newVal });
                    updateSelection(newVal);
                    if (setting === 'open-preference') updatePopupState(newVal);
                } else {
                    // Jika klik yang sama (unselect), paksa balik ke nilai lama
                    group.value = activeValue; 
                    updateSelection(activeValue);
                }
            });
            
            // Backup listener untuk memastikan klik pertama selalu bereaksi
            group.addEventListener('click', (e) => {
                const btn = e.target.closest('mdui-segmented-button');
                if (btn) {
                    const clickedVal = btn.value;
                    group.value = clickedVal;
                    browser.storage.local.set({ [setting]: clickedVal });
                    updateSelection(clickedVal);
                    if (setting === 'open-preference') updatePopupState(clickedVal);
                }
            });
        }
    }

    const colorResult = await browser.storage.local.get('theme-color');
    const colorInput = document.getElementById('color-picker-input');
    if (colorInput) {
        colorInput.value = colorResult['theme-color'] || '#bbdefb';
        colorInput.addEventListener('input', (e) => {
            browser.storage.local.set({ 'theme-color': e.target.value });
        });
    }
}

function updatePopupState(value) {
    if (value === 'popup') {
        browser.action.setPopup({ popup: 'popup.html' });
    } else {
        browser.action.setPopup({ popup: '' });
    }
}
