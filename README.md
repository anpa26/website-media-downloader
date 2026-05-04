# Website Media Downloader

[![Version](https://img.shields.io/badge/version-1.6.5-blue.svg)](src/manifest.json)
[![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Firefox%20%7C%20Android-orange.svg)](#installation)

Website Media Downloader is a professional-grade browser extension engineered for the identification and acquisition of digital media assets across the modern web. The tool integrates advanced network interception and Deep DOM analysis to capture video, audio, images, and complex streaming protocols.

Designed with a focus on privacy and technical transparency, all operations—including stream reconstruction and local decryption—are executed entirely within the client's browser environment. No external processing servers are utilized, ensuring data integrity and user privacy.

---

## Key Features
- **QR Code Sharing**: Generate QR codes for any detected media to easily transfer links to mobile devices.
- **Batch Operations**: Multi-select support for downloading or removing multiple items at once.
- **Advanced Filtering**: Filter results by category: Video, Audio, Streams, Images, or Subtitles.
- **Real-time Search**: Instantly find specific files using the integrated search bar.
- **Intelligent Deduplication**: Automatically hides duplicate media entries based on filename and metadata.
- **Offline Stream Conversion**: Merges stream segments (HLS/DASH) locally in the browser.

## How to Use
1. **Detection**: Navigate to any website with media content. The extension automatically detects assets in the background.
2. **Access**: Click the extension icon to open the popup interface.
3. **Manage**: Use the search bar or category filters to find specific media.
4. **Download**: Click the download icon for individual files, or use checkboxes for batch downloads.
5. **Share**: Use the QR code icon to quickly share media links to other devices.

---

## Disclaimer

- **User Responsibility**: The use of this tool is entirely at the user's own risk. Users are responsible for ensuring their actions comply with the terms of service of the websites they visit and all applicable laws and regulations. The developers assume no liability for any misuse of this tool.
- **Non-Supported Platforms**: This extension **does not support YouTube** or any other platforms that are explicitly restricted by technical or legal limitations. It is intended for use only on websites where media acquisition is permitted.

---

## Technical Features (v1.6.5)

### UI Architecture
The interface has been completely overhauled using Material Design 3 (MDUI) components, providing a responsive and standardized user experience.

### Detection Methodology
- Network Traffic Interception: Monitors real-time network requests to identify high-bitrate media and dynamic streaming manifests (M3U8 and MPD).
- Deep DOM Scanning: Systematically inspects HTML5 tags, custom data attributes, and elements managed by lazy-loading frameworks.
- CSS Analysis: Identifies media assets embedded within computed styles, such as background and border images.

### Stream Reconstruction
- HLS (M3U8): Supports master and media playlists with variant selection for specific resolutions. It handles local AES-128 decryption and merges segments into standardized containers.
- DASH (MPD): Parses XML-based manifests to extract video and audio adaptation sets.
- Parallel Acquisition: Implements a multi-threaded fetching mechanism to optimize throughput and reduce download duration.

### Request Simulation
The extension utilizes header management (Referer, Origin, and Cookies) to replicate the original request context, ensuring compatibility with servers that implement access restrictions based on request origins.

---

## Supported Formats

| Category | Formats |
| :--- | :--- |
| **Video** | mp4, mkv, webm, avi, mov, flv, ts, m4v, 3gp, mpeg, mpg, vob, vp9 |
| **Audio** | mp3, aac, flac, wav, ogg, m4a, opus, ac3, m4b, mka, vorbis |
| **Streams** | m3u8 (HLS), mpd (DASH), f4m (HDS), ism/isml |
| **Images** | webp, png, jpg, jpeg, gif, svg |
| **Subtitles** | vtt, srt, ass, ssa, ttml |

---

## Installation

Website Media Downloader is optimized for the Firefox ecosystem.

### Firefox Desktop
1. Navigate to `about:config` and set `xpinstall.signatures.required` to `false`.
2. Open `about:addons` and select "Install Add-on From File...".
3. Select the extension package from your local directory.

### Firefox Android
1. **Signature Configuration**: Navigate to `about:config` in the address bar. Search for `xpinstall.signatures.required` and set it to `false`.
2. **Activate Debug Menu**: Navigate to Settings > About Firefox. Tap the Firefox logo five times sequentially to unlock the Debug menu.
3. **Configure Collection**: Access Settings > Custom Add-on Collection. Input the required Collection ID and Collection Name from your AMO profile.
4. **Deployment**: The extension will be available for installation within the standard Add-ons menu.

---

## Security and Privacy Model

- Local Execution: All media processing, merging, and decryption are performed client-side.
- Zero Telemetry: No browsing data, media URLs, or user history are transmitted to external servers.
- Permission Scope: Requires `webRequest` for discovery, `storage` for configuration, and `downloads` for file acquisition.

---

## Credits and Attributions

- Lead Developer: [anpa26](https://github.com/anpa26)
- Legacy Contributor: [helloyanis](https://github.com/helloyanis)

### Software Libraries
- Material Design Framework: [MDUI](https://www.mdui.org/)
- HLS Engine: [HLS.js](https://github.com/video-dev/hls.js/)
- ZIP Management: [client-zip](https://github.com/Touffy/client-zip)
- QR Generation: [QRCode.js](https://github.com/davidshimjs/qrcodejs)

### Iconography
- Extension Iconography: Icons are derived from the Google Material Symbols and Icons library, utilized under the Apache License 2.0. Specific SVG implementations have been customized for the user interface.

---

Copyright (C) 2026 anpa26. Licensed under the [GNU General Public License v3.0](LICENSE.md).
