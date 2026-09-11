# Website Media Downloader

[![Version](https://img.shields.io/badge/version-2.3.3-blue.svg)](src/manifest.json)
[![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Firefox%20%7C%20Android-orange.svg)](#installation)

Website Media Downloader is a professional-grade browser extension designed to detect and download digital media assets across the modern web. It integrates advanced network interception and Deep DOM analysis to easily capture videos, audio tracks, images, and complex streaming protocols.

Designed with a strict focus on privacy and technical transparency, all operations, including stream reconstruction and local decryption, are executed entirely within the client's browser environment. No external processing servers are utilized, ensuring data integrity and absolute user privacy.

---

## Key Features
- **Download Video**: Seamlessly acquire high-quality video content from various online sources.
- **Download Audio Only**: Extract and download audio-only tracks from any media with ease.
- **Download Image**: Quickly capture and save images, including those nested in complex DOM structures.
- **Media Grouping**: Organize detected assets into dedicated categories (Videos, Audio, Streams, Images, Subtitles, Files) for a clean overview.
- **Manual URL Entry**: Directly enter file download links on the Home tab to start downloads immediately without waiting for auto-detection.
- **Material Design 3**: A modern, responsive, and intuitive interface powered by MDUI components with multiple layout choices (Collapsible, Sidebar, Tabs).
- **Universal Detection**: Captures real-time network requests and performs deep DOM scanning to identify hidden media assets.
- **Header Spoofing**: Automatically replicates Referer, Origin, and Cookies to bypass hotlinking and server-side access restrictions.
- **Offline Stream Conversion**: Merges HLS and DASH segments locally in the browser without using external servers.
- **QR Code Sharing**: Instantly generate QR codes for any detected media for easy transfer to mobile devices.
- **Batch Operations**: Multi-select support for downloading or removing multiple assets simultaneously.
- **Advanced Filtering & Search**: Granular category grouping and real-time search matching across filenames, URLs, hostnames, and page titles across all groups.
- **Download History**: Keep track of your previously detected and downloaded media for easy access later.
- **Background Downloading**: Supports background processes, allowing downloads to continue even after closing the extension popup.
- **Speed Boost**: Utilizes multi-threaded fetching and parallel acquisition to maximize download speeds and efficiency.
- **Intelligent Deduplication**: Automatically hides redundant entries based on filename and metadata.
- **Dual Update Detection**: Combines native browser update checking with a GitHub fallback, ensuring you always know when updates are available on the official store or GitHub.
- **Multi-language Support**: Fully localized for English, Indonesian, German, French, Portuguese, Japanese, Korean, Arabic, and Russian.

## How to Use
1. **Detection**: Navigate to any website with media content. The extension will automatically detect media assets in the background.
2. **Access**: Click the extension icon to open the popup interface.
3. **Group Navigation**: Browse media grouped by category (Videos, Audio, Streams, Images, Subtitles, Files) or use global search across all groups.
4. **Manual Download**: Use the "Add URL" button to manually input direct file download links at any time.
5. **Manage & Download**: Click individual download buttons or use multi-select checkboxes for batch actions.
6. **Share**: Use the QR code icon to instantly share media links to other devices.

---

## Disclaimer

- **Educational and Personal Use**: This tool is provided for educational and personal use only.
- **User Responsibility**: The use of this tool is entirely at the user's own risk. Users are solely responsible for their actions and any consequences resulting from the use of this tool. It is the user's responsibility to ensure compliance with the terms of service of any website visited and all applicable laws and regulations.
- **Developer Liability**: The developers are not responsible for any misuse, legal issues, or copyright violations. The developers assume no liability for any consequences resulting from the use of this tool.

---

## What's New in v2.3.3

- Added name and domain exclusions, including subdomains, with a switch to stop detecting excluded media.
- Improved automatic filenames using server metadata and URLs. Home names and sorting now respect filename templates.
- Kept detection notifications working with fallback names when smart naming or templates fail.
- Standardized normal and Speed Boost tests with warm-up, equal measurement durations, request cleanup, and error handling.
- Added settings import/export and corrected the badge to count only active downloads.
- Moved resume and background download options to Download settings and improved exclusion inputs.

## What's New in v2.3.2

- **Expanded Background Downloading**: Added wider support for background downloads to ensure seamless transfers when the popup is closed.
- **UI Optimization**: Optimized the user interface to make it slightly more lightweight and improve responsiveness.
- **DASH Stream Fixes**: Resolved preview and download issues with DASH streams so they function normally.

---

## Technical Features (v2.3.3)

### Core Detection Engine
The detection engine has been optimized to handle complex web environments more efficiently. This version introduces:
- **Enhanced Stream Detection**: Improved accuracy in identifying and filtering HLS and DASH segments to prevent redundant entries.
- **Parallel Acquisition Overhaul**: A refined multi-threaded fetching mechanism that provides more stable and efficient Speed Boost downloads.
- **Improved Lifecycle Management**: Enhanced cleanup and state persistence when reopening the extension popup while downloads are active.

### UI Architecture
The interface is built using Material Design 3 (MDUI) components, now featuring:
- **Media Grouping System**: Categorizes media into discrete cards (Videos, Audio, Streams, Images, Subtitles, Files) with live item counts and dedicated view navigation.
- **Multiple Settings Layouts**: Flexible settings interface supporting Collapsible sections, Sidebar navigation, or Tabbed layout.
- **Direct Manual URL Download**: Seamless entry point for adding external file download links directly into the media list.
- **Custom Pill Dropdowns**: A modern, space-efficient settings interface featuring dynamic sizing that fits content perfectly.
- **Visual Status Indicators**: Real-time visual feedback for Speed Boost status and multi-threaded download progress.
- **Comprehensive Localization**: A fully localized experience across 9 languages for all UI elements, including installation and error pages.

### Detection Methodology
- **Network Traffic Interception**: Monitors real-time network requests to identify high-bitrate media and dynamic streaming manifests, including M3U8 and MPD files.
- **Deep DOM Scanning**: Systematically inspects HTML5 tags, custom data attributes, and elements managed by lazy-loading frameworks.
- **CSS Analysis**: Identifies media assets embedded within computed styles, such as background and border images.

### Stream Reconstruction
- **HLS (M3U8)**: Supports master and media playlists with variant selection for specific resolutions. It handles local AES-128 decryption and merges segments into standardized containers.
- **DASH (MPD)**: Parses XML-based manifests to extract video and audio adaptation sets.
- **Parallel Acquisition**: Implements a multi-threaded fetching mechanism to optimize throughput and reduce download duration.

### Speed Boost Technology
Website Media Downloader features an advanced **Speed Boost** mechanism designed to saturate your bandwidth and significantly reduce download times.

#### How it Works
- **Single File Downloads**: For standard files (such as MP4, MP3, and other static files), the extension attempts to split the file into multiple chunks. It uses HTTP **Range Requests** to download these chunks simultaneously across multiple parallel connections.
- **Stream Downloads (HLS or DASH)**: Instead of fetching segments one by one, the extension initiates a pool of concurrent requests. This allows it to fetch multiple `.ts` or `.m4s` segments at the same time, bypassing the latency of sequential requests.

#### Key Differences
| Feature | Standard Download | Speed Boost |
| :--- | :--- | :--- |
| **Connections** | Single (1) | Multi-threaded (up to 16) |
| **Strategy** | Sequential fetching | Parallel acquisition |
| **Efficiency** | Limited by single-thread speed | Maximizes available bandwidth |
| **Resources** | Low CPU/RAM usage | Higher resource utilization |

#### Support & Requirements
- **Server Support**: For single files, the host server must support **Partial Content (HTTP 206)** and provide the `Accept-Ranges: bytes` header. If not supported, the extension automatically falls back to standard sequential downloading.
- **File Size**: Speed Boost is automatically triggered for files larger than **2MB** to ensure efficiency gains outweigh the overhead of managing multiple connections.
- **Visual Indicator**: When Speed Boost is supported and active, the download status text will turn **bold and use your themed/accent color**. If not supported (or for standard sequential downloads), the status text and progress bar will use the default standard appearance. You can configure the number of parallel connections (up to 16 connections) in the extension settings.

### Request Simulation
The extension utilizes header management, including Referer, Origin, and Cookies, to replicate the original request context. This ensures compatibility with servers that restrict access based on request origins.

### Update Mechanism
The extension features an advanced, multi-tiered update checker that automatically runs when the popup is opened.
- **Native Store Check**: On supported platforms, the extension performs a native update check against the Mozilla Add-ons (AMO) store. If an update is available on the store, you will be prompted to update directly from AMO.
- **GitHub Fallback**: If the native check is unavailable or fails, the extension queries the project's GitHub repository manifest file. This ensures you are notified of new versions as soon as they are released.

You can also manually trigger an update check at any time via the **About** page within the extension.

**Note on Store Updates vs. GitHub Releases:**
New versions are often published to GitHub before they pass the review process on the Mozilla Add-ons (AMO) store. If you are notified of a GitHub update while AMO still serves the older version, you can choose to wait for the official store update or manually install the latest release.

**Manual Installation (.xpi) for Firefox:**
To manually install the `.xpi` file from GitHub Releases, you **must use Firefox Developer Edition or Firefox Nightly**. Standard Firefox versions restrict the installation of unlisted or manually downloaded extensions for security reasons.
1. Open Firefox Developer Edition or Firefox Nightly and navigate to `about:config`.
2. Accept the risk warning, then search for `xpinstall.signatures.required` and double-click it to set it to **false**.
3. Download the latest `.xpi` file from the [GitHub Releases](https://github.com/anpa26/website-media-downloader/releases) page.
4. Navigate to the Add-ons manager (`about:addons`).
5. Click the gear icon and select **"Install Add-on From File..."**.
6. Select the downloaded `.xpi` file and confirm the installation.

---

## Supported Formats

| Category | Formats |
| :--- | :--- |
| **Video** | mp4, mkv, webm, avi, mov, flv, ts, m4v, 3gp, mpeg, mpg, vob, vp9, divx, 4v, m2t, m2ts, m2v, m4s, mk3d, mng, mp2v, mp4v, mpe, mxf, ogm, ogv, qt, rm, swf |
| **Audio** | mp3, aac, flac, wav, ogg, m4a, opus, ac3, m4b, mka, vorbis, 3ga, adts, aif, aiff, alac, ape, asf, au, dts, f4a, f4b, isma, it, m4r, mid, mod, mp1, mp2, mp4a, mpa, mpga, oga, ogx, ra, shn, spx, weba, wma, xm |
| **Streams** | m3u8 (HLS), mpd (DASH), f4m (HDS), ism/isml, f4f, smil |
| **Images** | webp, png, jpg, jpeg, gif |
| **Subtitles** | vtt, srt, ass, ssa, ttml, dfxp |
| **Other Files** | zip, rar, 7z, tar, gz, exe, msi, apk, dmg, iso, bin, pdf, epub, doc, docx, xls, xlsx, ppt, pptx |

---

## Project Structure

```
website-media-downloader/
├── src/                    # Shared source code & Firefox base
│   ├── _locales/
│   ├── icons/
│   ├── libraries/
│   ├── styles/
│   ├── overrides/          # Browser-specific overrides
│   │   ├── chrome/         # Chrome overrides
│   │   └── chrome-yt/      # Chrome-YT overrides
│   ├── *.js / *.html       # Extension logic & UI
│   ├── manifest.json       # Firefox base manifest
│   └── build.js            # Build script
└── build/                  # Build output (git-ignored)
    ├── chrome/
    ├── chrome-yt/
    └── firefox/
```

## Building

```bash
# Build Chrome, Chrome-YT, and Firefox
node src/build.js all

# Build Chrome only
node src/build.js chrome

# Build Chrome-YT only
node src/build.js chrome-yt

# Build Firefox only
node src/build.js firefox

# Clean build output
node src/build.js clean
```

Build output goes to `build/chrome/`, `build/chrome-yt/`, and `build/firefox/`, each containing a ready-to-load extension.

---

## Installation

Website Media Downloader is available for Chrome, Chrome-YT, and Firefox.

### Chrome / Chromium
1. Run `node src/build.js chrome` (or `node src/build.js chrome-yt` for the YouTube-enabled version)
2. Open `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select the `build/chrome/` (or `build/chrome-yt/`) folder

### Firefox Desktop & Android
You can install the extension directly from the official Firefox Add-ons store:

[**Download on Firefox Add-ons (AMO)**](https://addons.mozilla.org/en-US/firefox/addon/website-media-downloader/)

> [!TIP]
> **Recommended Platform**: While this extension supports Android, it is **highly recommended to use it on Desktop/PC** for the best experience. Desktop browsers offer better stability for background processing, stream reconstruction, and large batch ZIP downloads.

---

## Troubleshooting

- **Media not detected?** Try refreshing the page and playing the video again. If it still doesn't show up, go to Settings and enable "Detection via server's MIME response".
- **YouTube media not detected?** The detection might be rate-limited or blocked by your current network. Try changing your network connection or restarting your router.
- **Download fails?** Some sites use DRM (Digital Rights Management) or encryption. This extension cannot download encrypted content (like Netflix or Amazon Prime).
- **403 Forbidden on images?** This is often caused by session-based security tokens. It is highly recommended to stay on the current page until downloads are finished. Navigating to the next page or switching lists too quickly can invalidate the request context.
- **Broken files?** If a converted stream doesn't play, try downloading the "Direct Manifest" and playing it with VLC Media Player.

---

## Support & Feedback

**Thanks for using this extension!** You can use it completely for free without paying a single cent. Giving a star on GitHub or a rating is more than enough to show your support. If you encounter any bugs, please feel free to [open an issue](https://github.com/anpa26/website-media-downloader/issues).

If you want to develop this project further, please don't forget to include me in the credits to keep me motivated. Thank you!

---

## Security and Privacy Model

- **Local Execution**: All media processing, merging, and decryption are performed client-side.
- **Zero Telemetry**: No browsing data, media URLs, or user history are transmitted to external servers.
- **Permission Scope**: Requires `webRequest` for discovery, `storage` for configuration, and `downloads` for file acquisition.

---

## Credits and Attributions

- **Lead Developer**: [anpa26](https://github.com/anpa26)
- **Legacy Contributor**: [helloyanis](https://github.com/helloyanis)

### Software Libraries
- Material Design Framework: [MDUI](https://www.mdui.org/)
- HLS Engine: [HLS.js](https://github.com/video-dev/hls.js/)
- ZIP Management: [client-zip](https://github.com/Touffy/client-zip)
- QR Generation: [QRCode.js](https://github.com/davidshimjs/qrcodejs)
- Stream Transmuxing: [mux.js](https://github.com/videojs/mux.js)
- MP3 Encoding: [lamejs](https://github.com/zhuker/lamejs)
- Subtitle Processing: [subsrt](https://github.com/papnkukn/subsrt)
- Media Processing: [libav.js](https://github.com/Yahweasel/libav.js/)
- YouTube API: [wymd.js](https://github.com/anpa26/wymd.js)

---

Copyright (C) 2026 anpa26. Licensed under the [GNU General Public License v3.0](LICENSE.md).
