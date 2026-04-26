// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const streamUrl = urlParams.get('url');
    const size = urlParams.get('size');
    
    if (!streamUrl) {
        document.getElementById('status-header').textContent = "Error";
        document.getElementById('status-text').textContent = "No URL provided.";
        return;
    }

    const loadingBar = document.getElementById('stream-progress');
    const statusHeader = document.getElementById('status-header');
    const statusText = document.getElementById('status-text');
    const mediaTitle = document.getElementById('media-title');
    const actionArea = document.getElementById('action-area');
    const closeButton = document.getElementById('close-button');

    closeButton.addEventListener('click', () => window.close());

    try {
        // 1. Get request context from background
        const mediaRequests = await browser.runtime.sendMessage({ action: 'getMediaRequests' });
        const requests = mediaRequests[streamUrl];
        
        if (!requests || requests.length === 0) {
            throw new Error("Request details not found in session storage.");
        }

        // Find the specific request if size was provided
        const request = requests.find(r => r.size === size) || requests[0];
        
        mediaTitle.textContent = getFileName(streamUrl);
        statusHeader.textContent = "Downloading Stream";

        const headers = request.requestHeaders || [];
        const downloadMethod = await browser.storage.local.get('download-method').then(res => res['download-method'] || 'fetch');

        // 2. Start the appropriate offline download
        if (streamUrl.toLowerCase().includes('.m3u8')) {
            await downloadM3U8Offline(streamUrl, headers, downloadMethod, loadingBar, request);
        } else if (streamUrl.toLowerCase().includes('.mpd')) {
            await downloadMPDOffline(streamUrl, headers, downloadMethod, loadingBar, request);
        } else {
            throw new Error("Unsupported stream format.");
        }

        // 3. Complete
        statusHeader.textContent = "Download Complete!";
        statusText.textContent = "Your file has been saved.";
        loadingBar.setAttribute('value', 1);
        loadingBar.removeAttribute('indeterminate');
        actionArea.style.display = 'block';

    } catch (error) {
        console.error("Stream download failed:", error);
        statusHeader.textContent = "Download Failed";
        statusText.textContent = error.message;
        loadingBar.style.display = 'none';
        actionArea.style.display = 'block';
    }
});

// Helper for filename (copied from background.js/popup.js)
function getFileName(url, maxLength = 30) {
    try {
        let parsedUrl = new URL(url);
        let fileName = parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1).split('?')[0];
        fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        if (!fileName) fileName = parsedUrl.hostname;
        if (fileName.length > maxLength) fileName = fileName.substring(0, maxLength) + '…';
        return decodeURIComponent(fileName);
    } catch (e) { return "Media File"; }
}

// Ensure showDialog and other global helpers expected by offlineStreamConvert are present or shimmed
function showDialog(message, title) {
    mdui.alert({
        headline: title,
        description: message,
        confirmText: "OK"
    });
}
