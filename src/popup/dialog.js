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



function showConfirmDialog(message, title = null) {
  return new Promise((resolve) => {
    const dialog = document.createElement('mdui-dialog');
    dialog.headline = title || browser.i18n.getMessage("confirmTitle") || "Confirm";

    const description = document.createElement('div');
    description.setAttribute('slot', 'description');
    description.style.whiteSpace = 'pre-wrap';
    description.textContent = message;
    dialog.appendChild(description);

    const cancelButton = document.createElement('mdui-button');
    cancelButton.variant = "text";
    cancelButton.textContent = browser.i18n.getMessage("confirmCancelButton") || "Cancel";
    cancelButton.slot = 'action';
    cancelButton.addEventListener('click', () => {
      dialog.open = false;
      resolve('cancel');
    });
    dialog.appendChild(cancelButton);

    const skipButton = document.createElement('mdui-button');
    skipButton.variant = "text";
    skipButton.textContent = browser.i18n.getMessage("continueButton") || "Continue";
    skipButton.slot = 'action';
    skipButton.addEventListener('click', () => {
      dialog.open = false;
      resolve('continue');
    });
    dialog.appendChild(skipButton);

    const continueButton = document.createElement('mdui-button');
    continueButton.variant = "tonal";
    continueButton.textContent = browser.i18n.getMessage("continueAllButton");
    continueButton.slot = 'action';
    continueButton.addEventListener('click', () => {
      dialog.open = false;
      resolve('continue-all');
    });
    dialog.appendChild(continueButton);

    document.body.appendChild(dialog);
    dialog.open = true;

    dialog.addEventListener('closed', () => {
      dialog.remove();
    });
  });
}

function showDialog(message, title = null, extraActions = [], isHtml = false) {
  const dialog = document.createElement('mdui-dialog');

  if (isHtml && title && typeof title === 'string' && title.includes('<')) {
    const headline = document.createElement('div');
    headline.setAttribute('slot', 'headline');
    headline.style.width = '100%';
    headline.innerHTML = title;
    dialog.appendChild(headline);
  } else {
    dialog.headline = title || browser.i18n.getMessage("aboutChangelogTitle") || "Changelog";
  }

  const description = document.createElement('div');
  description.setAttribute('slot', 'description');
  if (isHtml) description.innerHTML = message;
  else description.textContent = message;
  dialog.appendChild(description);

  if (Array.isArray(extraActions)) {
    extraActions.forEach(action => {
      action.setAttribute('slot', 'action');
      dialog.appendChild(action);
    });
  }

  const okButton = document.createElement('mdui-button');
  okButton.variant = "text";
  okButton.textContent = browser.i18n.getMessage("okButton") || "OK";
  okButton.slot = 'action';
  okButton.style.marginRight = "-8px";
  okButton.addEventListener('click', () => {
    dialog.open = false;
  });
  dialog.appendChild(okButton);

  document.body.appendChild(dialog);
  dialog.open = true;

  dialog.addEventListener('closed', () => {
    dialog.remove();
  });
}

async function showQRCode(url) {
  await ensureScriptLoaded('libraries/qrcode.min.js', 'qrcode');
  const typeNumber = 0;
  const errorCorrectionLevel = 'L';
  const qr = qrcode(typeNumber, errorCorrectionLevel);
  qr.addData(url);
  qr.make();

  const uniqueId = 'qr-img-' + Date.now();
  const qrImageTag = qr.createImgTag(5);
  const modifiedQrImageTag = qrImageTag.replace('<img', `<img id="${uniqueId}" style="max-width: 100%; height: auto; cursor: zoom-in;" title="Click to enlarge"`);
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.gap = '16px';
  container.style.padding = '16px 0';
  container.innerHTML = `
    <div style="background: white; padding: 12px; border-radius: 8px; max-width: 250px; display: flex; justify-content: center;">
      ${modifiedQrImageTag}
    </div>
    <div style="word-break: break-all; font-size: 12px; opacity: 0.7; text-align: center; max-width: 250px;">
      ${escapeHtmlPopup(url)}
    </div>
  `;

  const openButton = document.createElement('mdui-button');
  openButton.variant = "text";
  openButton.textContent = browser.i18n.getMessage("qrCodeDialogOpenButton") || "Open";
  openButton.slot = 'action';
  openButton.addEventListener('click', () => {
    const iframeDialog = document.createElement('mdui-dialog');
    iframeDialog.closeOnOverlayClick = true;
    iframeDialog.closeOnEsc = true;
    iframeDialog.fullscreen = true;

    const headline = document.createElement('div');
    headline.setAttribute('slot', 'headline');
    headline.style.width = '100%';
    headline.style.display = 'flex';
    headline.style.justifyContent = 'space-between';
    headline.style.alignItems = 'center';

    const titleText = document.createElement('span');
    titleText.textContent = url;
    titleText.style.fontSize = '14px';
    titleText.style.overflow = 'hidden';
    titleText.style.textOverflow = 'ellipsis';
    titleText.style.whiteSpace = 'nowrap';
    titleText.style.maxWidth = '70%';

    headline.appendChild(titleText);
    iframeDialog.appendChild(headline);

    const iframe = document.createElement('iframe');
    try {
      const parsedQrUrl = new URL(url);
      if (parsedQrUrl.protocol === 'http:' || parsedQrUrl.protocol === 'https:') iframe.src = url;
    } catch (_) {}
    iframe.style.width = '100%';
    iframe.style.height = 'calc(100vh - 80px)';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';

    const copyBtn = document.createElement('mdui-button');
    copyBtn.variant = "text";
    copyBtn.textContent = browser.i18n.getMessage("copyURL") || "Copy URL";
    copyBtn.slot = 'action';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = browser.i18n.getMessage("copyURLSuccess") || "Copied!";
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 2000);
      });
    });

    const openTabBtn = document.createElement('mdui-button');
    openTabBtn.variant = "text";
    openTabBtn.textContent = (browser.i18n.getMessage("qrCodeDialogOpenButton") || "Open") + " Tab";
    openTabBtn.slot = 'action';
    openTabBtn.addEventListener('click', () => {
      browser.tabs.create({ url: url });
    });

    const closeBtn = document.createElement('mdui-button');
    closeBtn.variant = "text";
    closeBtn.textContent = browser.i18n.getMessage("cancelButton") || "Close";
    closeBtn.slot = 'action';
    closeBtn.addEventListener('click', () => {
      iframeDialog.open = false;
    });

    iframeDialog.appendChild(iframe);
    iframeDialog.appendChild(copyBtn);
    iframeDialog.appendChild(openTabBtn);
    iframeDialog.appendChild(closeBtn);
    document.body.appendChild(iframeDialog);
    iframeDialog.open = true;

    iframeDialog.addEventListener('closed', () => {
      iframeDialog.remove();
    });
  });

  showDialog(container.outerHTML, browser.i18n.getMessage("qrCodeDialogTitle") || "Scan QR Code", [openButton], true);

  setTimeout(() => {
    const imgEl = document.getElementById(uniqueId);
    if (imgEl) {
      imgEl.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'white';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.cursor = 'zoom-out';

        const fullImg = document.createElement('img');
        fullImg.src = imgEl.src;
        fullImg.style.width = '95vmin';
        fullImg.style.height = '95vmin';
        fullImg.style.imageRendering = 'pixelated';

        overlay.appendChild(fullImg);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => overlay.remove());
      });
    }
  }, 100);
}

let manualScanEnabled = false;
