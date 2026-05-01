# Website Media Downloader (Unleashed)

A powerful, open-source browser extension designed to detect and download virtually any media (audio, video, and streams) played in your browser. This version is a customized and improved fork of the original "Website Media Downloader".

> [!WARNING]
> **YouTube is NOT supported.** Due to legal restrictions and proprietary streaming methods, this extension does not work on YouTube.

---

## Disclaimer

This tool is provided for educational and personal use only. **Users are solely responsible for their actions and any consequences resulting from the use of this tool.** The developers are not responsible for any misuse, legal issues, or copyright violations. It is the user's responsibility to ensure compliance with the terms of service of any website visited and all applicable laws.

---

## Key Features

- **Multi-Format Support:** Detects everything from standard MP4/MP3 files to advanced HLS (M3U8) and DASH (MPD) streams.
- **Speed Boost (Parallel Downloads):** Significantly increase download speeds by fetching multiple segments of a file simultaneously. You can configure the number of concurrent connections in settings.
- **Improved Persistence:** Enhanced download stability with auto-resume support and background state storage, ensuring large or interrupted downloads complete reliably.
- **Optimized Storage:** High-performance IndexedDB engine with chunk buffering and batching for faster file reconstruction and reduced browser memory usage.
- **Offline Stream Conversion:** Automatically converts fragmented HLS/DASH streams into playable offline files (TS or ZIP) locally in your browser.
- **Smart Quality Grouping:** Automatically groups different quality variants of the same media to keep your detection list clean and organized.
- **Download History:** Keeps a local record of your downloads, tracks the original source page, and automatically refreshes expired links when you revisit the page.
- **Real-Time Notifications:** Optional system or in-page notifications when media is detected.
- **Customizable UI:** Clean Material Design 3 interface with customizable theme colors and the option to open as a dedicated tab or a popup.
- **Filename Templates:** Fully customizable naming using dynamic placeholders like `{title}`, `{name}`, `{host}`, `{date}`, and `{time}`.
- **Advanced Detection:** Multiple detection methods (URL-based and MIME-based) to ensure even hidden media is found.
- **Header Spoofing:** Automatically handles Referer and Origin headers to bypass common hotlinking protections.
- **Completely Private:** No tracking, no data collection. All processing happens locally on your device.

---

## How to Use

1. **Navigate:** Visit any website containing the video or audio you want to download.
2. **Play:** Start playing the media. The extension needs the media to start loading to "catch" the request.
3. **Capture:** Click the extension icon in your toolbar. A list of detected media will appear.
4. **Choose:** Select your preferred quality or file size from the list.
5. **Download:** Click the **Download** button. 
   - For streams, you may be asked to choose between "Direct Manifest" or "Offline Conversion".
   - For MPD/DASH, it will package the stream into a ZIP file for local playback.

---

## Smart Download History

The extension includes a powerful history management system:

- **Source Tracking:** Every download is saved along with its original page title and URL.
- **Automatic Link Refresh:** If a download link expires (e.g., token expiration), simply click **"Visit Page"** in your history. As soon as you play the video again, the extension will automatically update the history record with the latest working link.
- **Deduplication:** Keeps your history clean by automatically replacing old entries with the newest detection for the same media.
- **One-Click Re-download:** Quickly re-download any previously captured media directly from the History tab.

---

## Advanced Settings

- **Speed Boost:** Toggle parallel downloads. When enabled, the extension will split large files into multiple chunks and download them at the same time, maxing out your bandwidth.
- **Connections:** Choose how many parallel connections to use (e.g., 2, 4, 8). Higher values are faster but may be blocked by some servers.
- **Stream Download Method:**
    - **Offline Conversion (Recommended):** Fetches all segments and combines them into a single file locally. Supports pausing and resuming.
    - **Direct Manifest:** Provides the raw .m3u8 or .mpd link for use in external players like VLC.
- **Appearance:** Change the primary theme color to match your preference.
- **Open Preference:** Choose whether the extension opens in a small popup or a full-sized browser tab.

---

## Installation

### Firefox (Installation of Unsigned XPI)
Since this version is customized and not from the official store, you need to allow unsigned extensions in Firefox:
1. Open Firefox and type `about:config` in the address bar.
2. Search for `xpinstall.signatures.required`.
3. Set it to `false` by double-clicking it.
4. Now you can install the `.xpi` file via `about:addons` -> Gear icon -> "Install Add-on From File...".

*Note: This usually works in Firefox Developer Edition, Nightly, or Android (via custom collections).*

---

## Supported Formats

- **Video:** `mp4`, `mkv`, `mov`, `webm`, `ts`, `avi`, `flv`, `m4v`, `mpeg`, and many more.
- **Audio:** `mp3`, `aac`, `ogg`, `wav`, `flac`, `m4a`, `opus`, etc.
- **Streams:** `m3u8` (HLS), `mpd` (DASH).
- **Subtitle:** `VTT`, `SRT`, `ASS`, `SSA`.

---

## Troubleshooting

- **Media not detected?** Try refreshing the page and playing the video again. If it still doesn't show up, go to **Settings** and enable "Detection via server's MIME response".
- **Download fails?** Some sites use DRM (Digital Rights Management) or encryption. This extension cannot download encrypted content (like Netflix or Amazon Prime).
- **Broken files?** If a converted stream doesn't play, try downloading the "Direct Manifest" and playing it with **VLC Media Player**.

---

## Credits & License

- **Original Creator:** [helloyanis](https://github.com/helloyanis)
- **Improved by:** [anpa26](https://github.com/anpa26)
- **UI Framework:** [MDUI](https://www.mdui.org/)
- **Libraries:** [HLS.js](https://github.com/video-dev/hls.js/), [client-zip](https://github.com/jimmywarting/client-zip)

Licensed under the MIT License.
