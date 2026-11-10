---
tags:
  - technical
  - ffmpeg
  - video-encoding
aliases:
  - h264 encoding, mp4 compatibility, faststart, player compatibility, ffmpeg encoding
cssclasses:
  - technical-guide
date: 2026-11-10
type: concept
---

> [!info] Purpose
> Encode recipes and compatibility rules for MP4 outputs produced by this
> repo's pipelines (MuseTalk lip-sync, shape-swap compositor, ffmpeg
> post-processing), so rendered files play in Windows Media Player,
> foobar2000, browsers, and browsers' strict decoders — not just in ffmpeg.

---

## The incident that prompted this

`output/video/maya_avatar_v3_mouth_shapes.mp4` (Path C shape-swap render,
2026-11-10) played **audio-only in foobar2000** and was **refused entirely by
Windows Media Player**, while `ffprobe` reported a clean h264 High / yuv420p /
AAC stream and a full decode-to-null produced zero errors.

Likely contributors, in order of suspicion:

1. **Audio sample rate.** The source MP3 is 24 kHz mono; the mux copied it
   into AAC at 24 kHz. 44.1/48 kHz is the safe range — 24 kHz AAC is legal but
   outside what many players' decoders accept, and a strict player can reject
   the whole file over one odd stream.
2. **`moov` atom at end of file.** ffmpeg writes `moov` after `mdat` by
   default; players that probe headers strictly (or stream without range
   requests) can fail. `-movflags +faststart` moves it to the front.
3. **Missing color metadata.** No `bt709`/`tv` tags written; some players
   guess wrong but this rarely causes refusal.

A `+faststart` remux (`maya_avatar_v3_mouth_shapes_faststart.mp4`) was
produced as the first remediation; audio resample to 44.1 kHz stereo is the
recommended permanent fix (see recipe below).

## What plays everywhere (2026 research)

Container/codec matrix for "plays in WMP, VLC, mpv, browsers, phones":

| Type | Safe choice | Risky / avoid |
| --- | --- | --- |
| Container | MP4 (ISO BMFF) | MKV/WebM fine for VLC/mpv, poor WMP support |
| Video | H.264/AVC, `yuv420p`, 8-bit | HEVC needs `hvc1` tag for Apple; AV1/VP9 browser-dependent; ProRes/DNxHR rejected in MP4 |
| H.264 profile | High (universal on devices ≤5 yrs old); Baseline/Main only for legacy | — |
| H.264 level | Auto is fine; practical bitrates stay far below level caps | — |
| Audio | AAC-LC, **44.1 or 48 kHz**, stereo or mono | 24 kHz or other odd rates; PCM/Vorbis in MP4 (legal per ffmpeg, unread by most players) |
| Subtitles | `mov_text` only inside MP4 | SRT/ASS rejected in MP4 |
| `moov` position | Front (`+faststart`) for anything streamed/uploaded; harmless locally | End-of-file `moov` breaks naive streamers |
| Color tags | `bt709`/`tv` for HD content | Untagged → player-dependent interpretation |

Notes:

- **foobar2000 is an audio player.** "Audio only" there is expected behavior
  for any MP4 — video needs a preview plugin or external player. Do not treat
  foobar2000 as a video-compat test; use WMP/mpv/VLC/browser instead.
- Firefox uses the OS H.264 decoder; extremely large frame sizes (>~2304 px
  height historically) can fail. Our 1024–1254 px outputs are fine.
- `-tune animation` is appropriate for illustrated/anime content (flat
  regions, hard edges) vs `-tune film` for live action.

## Recommended encode recipe for this repo

Baseline for any rendered MP4 that must play everywhere:

```powershell
ffmpeg -i input -c:v libx264 -preset medium -crf 18 `
  -pix_fmt yuv420p -profile:v high `
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" `
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 `
  -c:a aac -b:a 160k -ar 44100 -ac 2 `
  -movflags +faststart output.mp4
```

For the shape-swap compositor (`docs/scratch/lipsync_shapes_v1.py`), the
ffmpeg pipe command should additionally include `-ar 44100 -ac 2` on the
output audio and `-movflags +faststart`. Audio inputs at 24 kHz (the F5 clone
lines) must be resampled — never stream-copy odd rates into the container.

CRF guidance: 18–22 for approval/review renders, 23 default, ≤17 for
archival. `-preset slow` buys ~5–10% bitrate at same quality; `medium` is the
practical default on this machine.

## Diagnostic checklist when a render "won't play"

1. `ffprobe -show_entries stream=codec_name,profile,pix_fmt,sample_rate,channels` — look for odd sample rates, non-yuv420p, unusual profiles.
2. `ffmpeg -v error -i file -f null -` — full decode; errors here mean real corruption.
3. `ffprobe -show_entries format_tags` / check `moov` position → remux with `-movflags +faststart -c copy`.
4. Isolate streams: `-an` (video only) / `-vn` (audio only) to find which stream the player rejects.
5. Compare against a known-good render from the same pipeline (MuseTalk outputs play in WMP — they carry standard audio rates).

## Sources

- FFmpeg HowTo — H.264/MP4 CRF, presets, faststart: https://www.ffmpeg-howto.de/en/convert/h264-mp4-crf/
- Academy Software Foundation Encoding Guidelines — H.264 pixel formats, color tags, faststart: https://academysoftwarefoundation.github.io/EncodingGuidelines/Encodeh264.html
- Encode.wiki MP4 container matrix — safe codecs/audio per player: https://encode.wiki/containers/mp4
- Streaming Learning Center — H.264 profiles/levels explainer: https://streaminglearningcenter.com/codecs/beginners-guide-to-encoding-h264.html
- foobar2000 formats page — native audio-only scope: https://www.foobar2000.org/formats

## Related

- [[musetalk-quality-and-stylized-lip-sync-options-2026]]:see-also — the lip-sync pipeline work that produced the triggering render
- Rendered files must land under `output/` per the `media-output-contract` project skill for Media Library visibility.
