A browser add-on to easily download any media (audio, video and streams) played in the browser! *(Not compatible with YouTube)*

> [!IMPORTANT]
> This add-on is currently only available on the Firefox Add-ons store. Beware of any copies that you may find elsewhere, like on the Chrome web store or the Edge store!
> It's not on these stores because :
> - Chrome web store wants to get a $5 payment for opening the account which is fundamentally incompatible for a non-profit open-source app
> - Edge does not want to accept the add-on because some features (like the icon) don't work fully, even though the core downloading process works fine.

### How to install on Chrome, Edge, Chromium, etc...
1. Get the `addon.xpi` file from the [releases page](https://github.com/anpa26/website-media-downloader/releases) (scroll down for a bit to see it)
2. Rename it to `addon.zip`, and extract it in its own folder
3. Sideload it in your browser. See your browser documentation for more info. To sideload it on Chrome :
   - Open Chrome's `...` menu, then `Extensions`, `Manage browers extensions`
   - Enable the `Developer mode` switch
   - Click `Load unpacked extension` and chose the folder you just extracted earlier. It should have a `manifest.json` file in it.

> [!WARNING]
> If you use the add-on on Chromium based browsers, these features are known to be broken :
> - The extension shows a default icon, or no icon
> - The detected media list does not show which website made the request, nor the time it happened at.
> - The "Report a problem" button does not work
> - Some settings might be broken
> 
> The development is mainly focused towards Firefox for desktop and Android so these are not going to be fixed. Use firefox for the best experience!

## Supporded media types

- 🎬 Video : `3g2`, `3gp`, `asx`, `avi`, `divx`, `4v`, `flv`, `ismv`, `m2t`, `m2ts`, `m2v`, `m4s`, `m4v`, `mk3d`, `mkv`, `mng`, `mov`, `mp2v`, `mp4`, `mp4v`, `mpe`, `mpeg`, `mpeg1`, `mpeg2`, `mpeg4`, `mpg`, `mxf`, `ogm`, `ogv`, `qt`, `rm`, `swf`, `ts`, `vob`, `vp9`, `webm`, `wmv`
- 🎵 Audio : `3ga`, `aac`, `ac3`, `adts`, `aif`, `aiff`, `alac`, `ape`, `asf`, `au`, `dts`, `f4a`, `f4b`, `flac`, `isma`, `it`, `m4a`, `m4b`, `m4r`, `mid`, `mka`, `mod`, `mp1`, `mp2`, `mp3`, `mp4a`, `mpa`, `mpga`, `oga`, `ogg`, `ogx`, `opus`, `ra`, `shn`, `spx`, `vorbis`, `wav`, `weba`, `wma`, `xm`
- 📺 Stream : `f4f`\*, `f4m`\*, `m3u8`, `mpd`, `smil`\*

> [!NOTE]
> `*` means partial support. Can download the stream manifest, but not convert to offline video/audio. You can use a third-party tool like ffmpeg to convert the downloaded stream manifest to offline video/audio, or use VLC to play the stream manifest.

- Can change settings to show all requests without filtering if your media is not detected by default.

> [!NOTE]
> Some sites may not work with the add-on due to DRM or other restrictions. If you encounter any issues, please report them on the [GitHub page](https://github.com/anpa26/website-media-downloader/issues)

#### What this add-on does

You can download audios, videos and streams to view offline, from most websites!

- Support for video, audio, and .m3u8 streams
- Clean interface with material design!
- Easy to use settings!
- Multiple detection and download methods to try to find one that works on the site!
- Media preview in the browser!
- Spoof headers and referrer to play and download videos from sites with protections!
- Completely free and open-source! Nothing to pay at all! (Except for donations, which are optional and does not unlock any features)

#### Third party libraries used :

- [MDUI](https://www.mdui.org/en/) - Material Design UI framework (MIT License)
- [HLS.js](https://github.com/video-dev/hls.js/) - HLS.js library to play media in the browser (Apache License 2.0) 
- [JSZIP](https://github.com/Stuk/jszip) - Download zip files when getting mpd streams (Dual license, MIT and GPL v3)
