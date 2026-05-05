# Website Media Downloader

[![Version](https://img.shields.io/badge/version-1.7.1-blue.svg)](src/manifest.json)
[![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Firefox%20%7C%20Android-orange.svg)](#installation)

Website Media Downloader is a professional-grade browser extension engineered for the identification and acquisition of digital media assets across the modern web. The tool integrates advanced network interception and Deep DOM analysis to capture video, audio, images, and complex streaming protocols.

Designed with a focus on privacy and technical transparency, all operations—including stream reconstruction and local decryption—are executed entirely within the client's browser environment. No external processing servers are utilized, ensuring data integrity and user privacy.

---

## Key Features
- **Download Video**: Seamlessly acquire high-quality video content from various sources.
- **Download Audio Only**: Effortlessly extract and download audio-only tracks from any media.
- **Download Image**: Quickly capture and save images, including those from complex DOM structures.
- **Material Design 3**: A modern, responsive, and intuitive interface powered by MDUI components.
- **Universal Detection**: Captures real-time network requests and performs deep DOM scanning to identify hidden media assets.
- **Header Spoofing**: Automatically replicates Referer, Origin, and Cookies to bypass hotlinking and server-side access restrictions.
- **Offline Stream Conversion**: Merges HLS (M3U8) and DASH (MPD) segments locally in the browser without external servers.
- **QR Code Sharing**: Instantly generate QR codes for any detected media for easy transfer to mobile devices.
- **Batch Operations**: Multi-select support for downloading or removing multiple assets simultaneously.
- **Advanced Filtering**: Granular toggles to filter results by category: Video, Audio, Streams, Images, or Subtitles.
- **Real-time Search**: Quickly locate specific files with the integrated instant search bar.
- **Download History**: Keep track of your previously detected and downloaded media for easy access later.
- **Background Downloading**: Supports background processes, allowing downloads to continue even after closing the extension popup.
- **Speed Boost**: Utilizes multi-threaded fetching and parallel acquisition to maximize download speeds and efficiency.
- **Intelligent Deduplication**: Automatically hides redundant entries based on filename and metadata.
- **Multi-language Support**: Fully localized for English, Indonesian, German, French, and Portuguese.

## How to Use
1. **Detection**: Navigate to any website with media content. The extension automatically detects assets in the background.
2. **Access**: Click the extension icon to open the popup interface.
3. **Manage**: Use the search bar or category filters to find specific media.
4. **Download**: Click the download icon for individual files, or use checkboxes for batch downloads.
5. **Share**: Use the QR code icon to quickly share media links to other devices.

---

## Disclaimer

- **Educational and Personal Use**: This tool is provided for educational and personal use only.
- **User Responsibility**: The use of this tool is entirely at the user's own risk. Users are solely responsible for their actions and any consequences resulting from the use of this tool. It is the user's responsibility to ensure compliance with the terms of service of any website visited and all applicable laws and regulations.
- **Developer Liability**: The developers are not responsible for any misuse, legal issues, or copyright violations. The developers assume no liability for any consequences resulting from the use of this tool.
- **Non-Supported Platforms**: This extension **does not support YouTube** or any other platforms that are explicitly restricted by technical or legal limitations. It is intended for use only on websites where media acquisition is permitted.

---

## Technical Features (v1.7.1)

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
| **Images** | webp, png, jpg, jpeg, gif |
| **Subtitles** | vtt, srt, ass, ssa, ttml |

---

## Installation

Website Media Downloader is officially available for the Firefox ecosystem.

### Firefox Desktop & Android
You can install the extension directly from the official Firefox Add-ons store:

[**Download on Firefox Add-ons (AMO)**](https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader/)

> [!TIP]
> **Recommended Platform**: While this extension supports Android, it is **highly recommended to use it on Desktop/PC** for the best experience. Desktop browsers offer better stability for background processing, stream reconstruction, and large batch ZIP downloads.

---

## Troubleshooting

- **Media not detected?** Try refreshing the page and playing the video again. If it still doesn't show up, go to Settings and enable "Detection via server's MIME response".
- **Download fails?** Some sites use DRM (Digital Rights Management) or encryption. This extension cannot download encrypted content (like Netflix or Amazon Prime).
- **403 Forbidden on images?** This is often caused by session-based security tokens. It is highly recommended to stay on the current page until downloads are finished. Navigating to the next page or switching lists too quickly can invalidate the request context.
- **Broken files?** If a converted stream doesn't play, try downloading the "Direct Manifest" and playing it with VLC Media Player.

---

## Support & Feedback

**Thanks for using this extension!** You can use it completely for free without paying a single cent. Giving a star on GitHub or a rating is more than enough to show your support. If you encounter any bugs, please feel free to [open an issue](https://github.com/anpa26/website-media-downloader/issues).

If you want to develop this project further, please don't forget to include me in the credits to keep me motivated. Thank you!

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
