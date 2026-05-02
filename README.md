# Website Media Downloader

A powerful, open-source browser extension designed to detect and download virtually any media (audio, video, and streams) played in your browser. This version is a customized and improved fork of the original project, [media-downloader-unleashed](https://github.com/helloyanis/media-downloader-unleashed).

> [!WARNING]
> **YouTube is NOT supported.** Due to legal restrictions and proprietary streaming methods, this extension does not work on YouTube.

---

## Disclaimer

This tool is provided for educational and personal use only. **Users are solely responsible for their actions and any consequences resulting from the use of this tool.** The developers are not responsible for any misuse, legal issues, or copyright violations. It is the user's responsibility to ensure compliance with the terms of service of any website visited and all applicable laws.

---

## What's New in Version 1.6.x

- **UI Overhaul:** A complete visual modernization using Material Design 3, providing a more fluid and professional experience.
- **Batch Processing:** Added multi-select support allowing users to download or delete multiple media items simultaneously.
- **Instant Search:** Powerful real-time filtering to find specific media in long detection lists.
- **QR Code Sharing:** Easily transfer detected download links to your mobile device by scanning a generated QR code.
- **Enhanced Stability:** Major bug fixes for the auto-resume engine, ensuring interrupted background downloads are handled more reliably.
- **Performance:** Refined RAM usage and faster list rendering for sites with hundreds of detected segments.

---

## Key Features

- **Search & Filter:** Instantly find specific media by name, format, or hostname using the integrated search bar.
- **Batch Actions (Multi-Select):** Select multiple detected items at once to download, delete, or cancel in bulk, saving you time.
- **Mobile Sharing (QR Code):** Generate a QR code for any detected link to instantly scan and download the media on your smartphone or tablet.
- **Speed Boost (Parallel Downloads):** Significantly increase download speeds by fetching multiple segments of a file simultaneously. You can configure concurrent connections (up to 16) in settings.
- **Modern UI:** Fully redesigned Material Design 3 interface with smooth animations, intuitive card layouts, and customizable theme colors.
- **Enhanced Persistence:** Industry-leading download stability with background state management and intelligent auto-resume for interrupted fetches.
- **Optimized Storage:** High-performance IndexedDB engine with 1MB chunk buffering for faster reconstruction and minimal RAM impact.
- **Offline Stream Conversion:** Locally converts fragmented HLS (M3U8) and DASH (MPD) streams into playable files (TS or ZIP) without external servers.
- **Smart Quality Grouping:** Automatically merges different quality variants of the same media to keep your detection list clean and focused.
- **Download History:** Tracks source pages, titles, and timestamps. Features an automatic "Link Refresh" that updates expired URLs when you revisit a page.
- **Real-Time Notifications:** Optional system or in-page "Toasts" when media is detected, allowing one-click downloads without opening the extension.
- **Filename Templates:** Dynamic naming using placeholders like `{title}`, `{name}`, `{host}`, `{date}`, and `{time}`.
- **Advanced Detection:** Dual-mode detection (URL-based and MIME-based) captures even the most elusive media requests.
- **Header Spoofing:** Intelligent Referer and Origin management to bypass hotlinking protections seamlessly.
- **Privacy Focused:** No tracking, no external API calls, no data collection. Everything stays on your machine.

---

## How to Use

1. **Navigate:** Visit any website containing the video or audio you want to download.
2. **Play:** Start playing the media. The extension needs the media to start loading to "catch" the request.
3. **Capture:** Click the extension icon in your toolbar. A list of detected media will appear.
4. **Choose:** Select your preferred quality or file size. You can also use the **search bar** to filter items or the **checkboxes** to select multiple items for batch downloading.
5. **Download:** Click the **Download** button on a single item, or use the **"Download All"** / **"Download Selected"** buttons for bulk actions.
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

---

### License Information

This project is a **derivative work**. 

- The overall project and all new modifications are licensed under the **GNU General Public License v3.0 (GPL-3.0)**. See the [LICENSE.md](LICENSE.md) file for details.
- This project contains original components and core logic from the original **media-downloader-unleashed** which was licensed under the **MIT License**. A copy of the original MIT license can be found in [licenses/ORIGINAL_LICENSE](licenses/ORIGINAL_LICENSE).

By using, modifying, or distributing this software, you agree to abide by the terms of both licenses where applicable.
