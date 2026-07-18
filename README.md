# Fydelity — build v1

This is a working build, not just the UI mockup — folder picking, library
scanning, real playback (including FLAC and APE), a real 10-band EQ, and a
storage screen with real numbers are all wired up. Read this whole file
before packaging with HTML2App; there are two things (below) that need a
decision from you.

## How FLAC and APE playback actually works

Browsers/WebViews don't all agree on what they can decode natively, and APE
(Monkey's Audio) isn't decoded natively *anywhere* — no browser ships an APE
decoder. So Fydelity uses a hybrid strategy, implemented in
`public/js/audio-engine.js`:

| Format | Strategy |
|---|---|
| MP3, M4A, AAC, WAV | Native `<audio>` playback. Universally supported. |
| FLAC | Tries native `<audio>` first (`canPlayType`). Most current Chromium-based Android WebViews decode FLAC natively — if so, it plays instantly, no extra work. If not, falls back to the same path as APE. |
| APE | **Always** decoded via `ffmpeg.wasm`, entirely on-device, entirely offline. Nothing is uploaded anywhere. |
| OGG | Never decoded. The UI intercepts `.ogg` files before they ever reach the audio engine and shows the "not supported" alert instead. |

The `ffmpeg.wasm` decode path transcodes the file to WAV in-memory
(`ffmpeg.writeFile` → `ffmpeg.exec(['-i', ..., '-f', 'wav', ...])` →
`ffmpeg.readFile`), then hands the browser a Blob URL to play. Nothing is
written to the device's actual storage — the decoded audio lives in memory
for the session only, consistent with the "referenced, not copied" storage
model we designed in Settings. Decoded tracks are cached in memory per
session so replaying the same track doesn't re-decode it.

The `ffmpeg-core.wasm` binary is ~31 MB. It's only fetched the *first* time
a track actually needs it (first APE, or first non-natively-playable FLAC) —
if someone's whole library is MP3/AAC/native-FLAC, it's never downloaded at
all. Settings → Playback shows which path FLAC is actually taking on the
current device ("Native (WebView)" vs "ffmpeg.wasm"), so you can verify this
live once it's packaged and running on a real phone.

## Folder access: two decisions HTML2App forces on us

**1. File System Access API vs. plain file input.**
`public/js/file-source.js` tries `window.showDirectoryPicker()` first (lets
Fydelity re-scan the same folder later without asking again — see the
"Re-scan linked folder" row in Settings). If the WebView doesn't support it,
it falls back to a plain `<input type="file" webkitdirectory>` picker, which
works everywhere but can't be silently re-opened — the user has to tap
"Choose Music Folder" again each time. **Which of these you actually get
depends entirely on the Chromium version inside HTML2App's WebView, and I
can't verify that from here** — Settings will tell you which mode is active
once it's running on your device (look at the "Referenced, not copied" vs
"Folder access, no persistence" card).

**2. Module Workers need to load over http(s), not `file://`.**
`ffmpeg.wasm` spins up a Web Worker, and Chromium blocks *module* workers
from loading under the `file://` scheme due to CORS. If HTML2App serves your
app's assets over `file://` directly, APE/fallback-FLAC decoding will fail
silently — check Settings → "APE decode path" and try playing an APE file as
your first real test. If it fails, the fix is on HTML2App's side: it needs
to serve local assets through a local origin (most WebView app-wrappers do
this via something like Android's `WebViewAssetLoader`, serving from
`https://appassets.androidplatform.net/...` instead of `file:///...`) —
check HTML2App's docs/settings for an option like "serve via local server"
or "use asset loader." Native-format playback (MP3/M4A/AAC/WAV/native-FLAC)
doesn't need a worker and will work fine either way.

## What's real vs. what's still a placeholder

Real: folder picking + recursive scan, native + ffmpeg.wasm playback
(including actual FLAC/APE decoding), the 10-band EQ (draggable, wired to
real `BiquadFilterNode`s), the VU meters (driven by an `AnalyserNode` reading
the actual decoded audio, not animated for show), next/prev/shuffle/repeat,
the storage screen (real per-format byte totals from your files, plus
`navigator.storage.estimate()` for the device-storage figure where the
WebView supports it), and the OGG alert.

Known simplification for this version: track title/artist come from the
filename, not from embedded tags (ID3/Vorbis comments/APE tags). Album art
is a generated color placeholder, not extracted cover art. Both are natural
next steps — happy to build a tag-reading pass next if you want real
metadata instead of filenames.

## Packaging with HTML2App

Point HTML2App at `public/index.html` as the entry file and make sure it
bundles the whole `public/` folder (css/, js/, vendor/) alongside it —
everything is relative-path, nothing is hardcoded to a domain. Total package
size will be ~32 MB, almost entirely the ffmpeg core — that's the real cost
of genuine on-device APE decoding, there isn't a lighter option that still
covers Monkey's Audio.

If HTML2App asks about permissions, it needs read access to device storage
(for the folder picker) and no other special permissions — nothing here
touches the network at runtime.
