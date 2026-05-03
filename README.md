# Website Media Downloader

## Introduction

Website Media Downloader is a comprehensive, professional-grade browser extension engineered for the sophisticated identification and acquisition of digital media assets across the modern web. Developed as a high-performance alternative to traditional media scrapers, this tool integrates advanced network interception and Document Object Model (DOM) analysis to provide a seamless experience for capturing video, audio, images, and complex streaming protocols.

The project is built on the principles of technical transparency and user privacy. All operations, including the reconstruction of segmented streams and the decryption of protected content, are executed locally within the client's browser environment. This architectural choice eliminates the need for external processing servers, thereby ensuring data integrity and minimizing latency during the media acquisition lifecycle.

---

## Technical Architecture and Core Features

### 1. Advanced Detection Methodologies

The application utilizes a multi-tiered approach to identify media assets that are often obscured by modern web frameworks:

- Network Traffic Interception: By leveraging low-level browser APIs, the extension monitors real-time network requests. This allows for the detection of high-bitrate media files and dynamic streaming manifests (M3U8 and MPD) that are generated during runtime and do not exist as static elements in the page source.
- Deep DOM Reciprocal Scanning: The engine performs an exhaustive search of the page's structural elements. This includes scanning standard HTML5 tags (video, audio, source, img, track), anchor links (a), and even custom data attributes (e.g., data-src, data-original, data-srcset) typically employed by lazy-loading libraries and modern JavaScript frameworks.
- CSS Asset Identification: The scanner inspects computed styles across all DOM elements to identify media assets embedded via CSS properties, such as background-image and border-image.

### 2. High-Fidelity Stream Reconstruction

The extension features a robust engine designed specifically for handling segmented media delivery protocols:

- HTTP Live Streaming (HLS/M3U8): The system identifies both master and media playlists. It provides a variant selection interface that allows users to target specific resolutions or bandwidths. The engine is capable of handling AES-128 encrypted segments, performing local decryption and merging them into a standardized container format (MP4 or TS).
- Dynamic Adaptive Streaming over HTTP (DASH/MPD): The extension parses complex XML-based MPD manifests to extract adaptation sets for video and audio. Users can acquire these tracks individually or package them into a standardized ZIP archive structure, facilitating local playback in compatible media players like VLC.
- Parallel Download Acceleration: To maximize throughput, the extension implements a multi-threaded fetching mechanism. By establishing multiple concurrent connections, the tool can download individual media segments in parallel, significantly reducing the total time required for high-definition stream acquisition.

### 3. Sophisticated Request Simulation

To bypass server-side security measures such as hotlinking protections and Referer-based blocking, the extension employs advanced header spoofing. It dynamically replicates the original request context—including Referer, Origin, and Cookie headers—ensuring that the download request appears legitimate to the hosting server.

---

## How to Use

### 1. Downloading Videos and Audio
- Navigate: Go to the website containing the video or audio you want to save.
- Play: Start the media playback. This triggers the network requests that the extension needs to capture the link.
- Detect: Click the Website Media Downloader icon in your browser toolbar.
- Download: Choose your preferred quality or format from the list and hit the download button.

### 2. Downloading Images (Scroll to Detect)
- Navigate: Open the page or link with the images you wish to download.
- Scroll: Simply scroll down the page. The extension's content detector will automatically "see" and capture images as they load or appear on your screen.
- Select: Click the extension icon and use the "Image" filter to view all detected visual assets.
- Batch Save: Select the images you want and download them individually or in bulk.

---

## Comprehensive Format Support

Website Media Downloader supports an expansive array of digital formats, ensuring compatibility with virtually any media encountered online:

- Video Content: mp4, mkv, webm, avi, mov, flv, wmv, ts, m4v, 3gp, 3g2, asx, divx, m2t, m2ts, m2v, m4s, mk3d, mng, mp2v, mp4v, mpeg, mpg, mxf, ogm, ogv, qt, rm, swf, vob, and vp9.
- Audio Content: mp3, aac, flac, wav, ogg, m4a, opus, ac3, adts, aif, aiff, alac, ape, asf, au, dts, f4a, f4b, isma, it, m4b, m4r, mid, mka, mod, mp1, mp2, mp4a, mpa, mpga, oga, ogx, ra, shn, spx, vorbis, weba, wma, and xm.
- Streaming Protocols: m3u8 (HLS), mpd (DASH), f4m (HDS), f4f, smil, and ism/isml.
- Visual Assets: webp, png, jpg, jpeg, gif, and svg.
- Textual/Subtitle Assets: vtt, srt, ass, ssa, ttml, and dfxp.

---

## Installation Guidelines

Website Media Downloader is optimized for the Firefox browser ecosystem, including Firefox for Android.

### Firefox Desktop (Windows, macOS, Linux)

1. Configuration: Enter about:config in the address bar. Search for the preference xpinstall.signatures.required and set its value to false.
2. Extension Management: Navigate to about:addons.
3. Installation: Select the gear icon and click "Install Add-on From File...". Choose the extension package from your local storage.

### Firefox Android

1. Debug Menu Activation: Navigate to Settings > About Firefox. Tap the Firefox logo sequentially five times to unlock the Debug menu.
2. Collection Configuration: Access Settings > Custom Add-on Collection. Input the appropriate Collection ID and Collection Name from your AMO (Add-ons Mozilla) profile.
3. Deployment: The extension will become available for installation within the standard Add-ons menu.

---

## Security and Permission Model

To ensure optimal performance and feature availability, the extension requires the following permissions:

- webRequest / webRequestBlocking: Necessary for the interception of network headers and media link discovery.
- storage / unlimitedStorage: Required for local data persistence, including user configurations, download history, and IndexedDB caching for large streams.
- downloads: Enables the extension to pass processed media blobs to the browser's native download manager.
- scripting: Facilitates the injection of the DOM scanning engine into web pages.
- host_permissions (<all_urls>): Allows the extension to operate globally across all web domains.

---

## Legal Considerations and Limitations

- YouTube Compliance: In accordance with legal requirements and platform policies, this extension does not support media acquisition from YouTube.
- DRM (Digital Rights Management): Content protected by encryption technologies such as Widevine, PlayReady, or FairPlay cannot be downloaded. The extension will notify the user if DRM protection is detected.
- User Responsibility: The user assumes all legal responsibility for the use of this tool. It is mandatory to comply with the terms of service of any website visited and all relevant copyright legislation.

---

## Credits and Attributions

### Development and Repository

- Lead Developer: anpa26 (https://github.com/anpa26)
- Legacy Contributor: helloyanis (https://github.com/helloyanis)
- Official Repository: https://github.com/anpa26/website-media-downloader

### Software Libraries

- Material Design Framework: MDUI (https://www.mdui.org/)
- HLS Engine: HLS.js (https://github.com/video-dev/hls.js/)
- ZIP Management: client-zip (https://github.com/Touffy/client-zip)
- QR Generation: QRCode.js (https://github.com/davidshimjs/qrcodejs)

### Iconography

- Extension Iconography: The application icons are derived from the Google Material Symbols and Icons library (https://fonts.google.com/icons), utilized under the Apache License 2.0. The specific SVG implementations have been customized for the Website Media Downloader user interface.

---

Copyright (C) 2026 anpa26. This project is licensed under the GNU General Public License v3.0.
