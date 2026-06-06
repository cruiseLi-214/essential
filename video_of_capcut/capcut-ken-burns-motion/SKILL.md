---
name: capcut-ken-burns-motion
description: Use when turning still images into subtle Ken Burns micro-motion video clips for CapCut, especially for 16:9 1080p MP4 outputs, viewer-retention pacing, avoiding PPT-like static slides, or batch processing numbered image folders into import-ready clips.
---

# CapCut Ken Burns Motion

## Purpose

Create CapCut-ready motion clips from still images using restrained Ken Burns movement: slow push-in around 105%-110%, 4-8 seconds per image, no audio, and predictable numbered outputs.

Default production spec:

- Output: MP4 H.264, `yuv420p`, no audio
- Canvas: `1920x1080` horizontal 16:9
- Frame rate: `30fps`
- Duration: `5s` per image unless the user specifies otherwise
- Motion: micro push-in with very light left/right/up variation, never aggressive spinning or flashy slide transitions

## Workflow

1. Find or create an input folder for real source images.
2. Confirm image count, filenames, and source dimensions.
3. Confirm the target aspect ratio. Default to `1920x1080`; if the user asks for vertical shorts, use `1080x1920`.
4. Ensure `ffmpeg` is available. Prefer a project-local binary such as `work/tools/ffmpeg`; otherwise use system `ffmpeg`.
5. Run `scripts/render_capcut_ken_burns.py` or adapt it into the current workspace.
6. Verify every output clip:
   - count matches source images
   - duration matches requested pacing
   - resolution and fps match the target
   - files are nonzero and CapCut-importable
   - create a contact sheet or frame preview when useful
7. Write a short handoff report with input path, output path, spec, and checksums.

## Folder Pattern

Use this structure for repeatable jobs:

```text
project/
├── outputs/
│   ├── 01_put_images_here/
│   ├── 02_dynamic_clips_for_capcut/
│   └── reports/
└── work/
    └── tools/
        └── ffmpeg
```

Use natural numeric ordering for filenames so `1`, `2`, ... `14` export in the intended sequence.

## Rendering

Use the bundled script when possible:

```bash
python scripts/render_capcut_ken_burns.py \
  --input outputs/01_put_images_here \
  --output outputs/02_dynamic_clips_for_capcut \
  --reports outputs/reports \
  --ffmpeg work/tools/ffmpeg \
  --width 1920 \
  --height 1080 \
  --duration 5 \
  --fps 30
```

If `ffmpeg` is missing on macOS and the user approves downloading a local project copy, use a static build source linked from FFmpeg's download page or an established static package. Keep the binary project-local unless the user explicitly asks for a system install.

## Motion Rules

- Keep motion subtle enough that text and fine image details remain readable.
- Prefer 5 seconds per image for narration-heavy videos; use 4 seconds for fast-paced montage; use 6-8 seconds for dense diagrams or quote slides.
- Use micro directional variation only to prevent repeated clips from feeling identical.
- Do not add audio, captions, transitions, or color grading unless the user asks; CapCut usually handles those final polish layers.
- Avoid generating intermediate PNG frames unless ffmpeg filters are insufficient; direct ffmpeg rendering is faster and cleaner.

## Maintenance

When this skill is used repeatedly, update it only from observed production needs:

- Add new presets only after at least two real jobs need the same variant.
- Prefer changing script defaults over adding separate scripts.
- Keep reports and verification strict; do not skip count, duration, and resolution checks.
- See `references/maintenance.md` before making recurring updates or overwriting the GitHub version.
