#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic"}
MOTIONS = (
    ("ken_burns_center", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),
    ("ken_burns_left_to_right", "(iw-iw/zoom)*on/{last}", "ih/2-(ih/zoom/2)"),
    ("ken_burns_right_to_left", "(iw-iw/zoom)*(1-on/{last})", "ih/2-(ih/zoom/2)"),
    ("ken_burns_low_to_high", "iw/2-(iw/zoom/2)", "(ih-ih/zoom)*(1-on/{last})"),
)


def natural_key(path: Path) -> list:
    parts = re.split(r"(\d+)", path.name)
    return [int(part) if part.isdigit() else part.casefold() for part in parts]


def slugify(value: str) -> str:
    value = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", value.strip(), flags=re.UNICODE)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "image"


def find_ffmpeg(explicit: str | None) -> Path:
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    found = shutil.which("ffmpeg")
    if found:
        candidates.append(Path(found))
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise SystemExit("ffmpeg not found. Pass --ffmpeg /path/to/ffmpeg or install/download a local ffmpeg binary.")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run_ffmpeg(ffmpeg: Path, src: Path, dest: Path, motion_index: int, args) -> tuple[str, str | None]:
    total_frames = int(args.fps * args.duration)
    last = max(total_frames - 1, 1)
    motion_name, x_expr, y_expr = MOTIONS[motion_index % len(MOTIONS)]
    x_expr = x_expr.format(last=last)
    y_expr = y_expr.format(last=last)
    zoom_delta = max(args.zoom_end - args.zoom_start, 0.0)
    zoom_expr = f"{args.zoom_start}+{zoom_delta}*on/{last}"
    vf = (
        f"scale={args.pre_scale}:-2,"
        f"zoompan=z='{zoom_expr}':x='{x_expr}':y='{y_expr}':d={total_frames}:"
        f"s={args.width}x{args.height}:fps={args.fps},"
        "format=yuv420p"
    )
    cmd = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-loop",
        "1",
        "-i",
        str(src),
        "-vf",
        vf,
        "-frames:v",
        str(total_frames),
        "-c:v",
        "libx264",
        "-preset",
        args.preset,
        "-crf",
        str(args.crf),
        "-movflags",
        "+faststart",
        "-an",
        str(dest),
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return motion_name, None
    except subprocess.CalledProcessError as exc:
        return motion_name, (exc.stderr or str(exc))[-1800:]


def inspect_clip(ffmpeg: Path, path: Path) -> dict:
    proc = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-i", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    text = proc.stderr
    duration = re.search(r"Duration: ([0-9:.]+)", text)
    size = re.search(r"Video: .*?, (\d+x\d+)", text)
    fps = re.search(r"(\d+(?:\.\d+)?) fps", text)
    return {
        "duration": duration.group(1) if duration else None,
        "size": size.group(1) if size else None,
        "fps": fps.group(1) if fps else None,
    }


def write_reports(manifest: dict, reports_dir: Path) -> None:
    reports_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / "asset_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# CapCut Ken Burns Render Report",
        "",
        f"- generated_at: {manifest['generated_at']}",
        f"- input_dir: {manifest['input_dir']}",
        f"- output_dir: {manifest['output_dir']}",
        f"- spec: {manifest['width']}x{manifest['height']}, {manifest['fps']}fps, {manifest['duration_seconds']}s per image",
        f"- zoom: {manifest['zoom_start']} to {manifest['zoom_end']}",
        f"- ffmpeg: {manifest['ffmpeg']}",
        f"- images_found: {len(manifest['assets'])}",
        "",
        "## Assets",
    ]
    checksums = []
    for item in manifest["assets"]:
        lines.extend([
            "",
            f"- {Path(item['source']).name}: {item['status']}",
            f"  - motion: {item['motion']}",
            f"  - output: {item.get('output') or 'not generated'}",
        ])
        if item.get("inspect"):
            lines.append(f"  - inspect: {item['inspect']}")
        if item.get("sha256"):
            checksums.append(f"{item['sha256']}  {item['output']}")
        if item.get("error"):
            lines.append(f"  - error: {item['error']}")
    (reports_dir / "render_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (reports_dir / "checksums.txt").write_text("\n".join(checksums) + ("\n" if checksums else ""), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Render still images into subtle Ken Burns MP4 clips for CapCut.")
    parser.add_argument("--input", required=True, help="Folder containing source images.")
    parser.add_argument("--output", required=True, help="Folder for rendered MP4 clips.")
    parser.add_argument("--reports", default=None, help="Folder for manifest, report, and checksums.")
    parser.add_argument("--ffmpeg", default=None, help="Path to ffmpeg. Falls back to PATH.")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--duration", type=float, default=5.0)
    parser.add_argument("--zoom-start", type=float, default=1.0)
    parser.add_argument("--zoom-end", type=float, default=1.075)
    parser.add_argument("--pre-scale", type=int, default=3840)
    parser.add_argument("--crf", type=int, default=18)
    parser.add_argument("--preset", default="veryfast")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()
    reports_dir = Path(args.reports).resolve() if args.reports else output_dir.parent / "reports"
    ffmpeg = find_ffmpeg(args.ffmpeg)
    output_dir.mkdir(parents=True, exist_ok=True)

    images = sorted([p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS], key=natural_key)
    assets = []
    for index, src in enumerate(images, 1):
        motion_name = MOTIONS[(index - 1) % len(MOTIONS)][0]
        dest = output_dir / f"{index:03d}_{slugify(src.stem)}_{motion_name}.mp4"
        motion_name, error = run_ffmpeg(ffmpeg, src, dest, index - 1, args)
        item = {
            "source": str(src),
            "output": str(dest) if dest.exists() else None,
            "status": "mp4_ready" if dest.exists() and error is None else "failed",
            "motion": motion_name,
            "duration_seconds": args.duration,
            "fps": args.fps,
            "size": f"{args.width}x{args.height}",
            "bytes": dest.stat().st_size if dest.exists() else 0,
            "error": error,
        }
        if dest.exists():
            item["sha256"] = sha256(dest)
            item["inspect"] = inspect_clip(ffmpeg, dest)
        assets.append(item)

    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "input_dir": str(input_dir),
        "output_dir": str(output_dir),
        "width": args.width,
        "height": args.height,
        "fps": args.fps,
        "duration_seconds": args.duration,
        "zoom_start": args.zoom_start,
        "zoom_end": args.zoom_end,
        "ffmpeg": str(ffmpeg),
        "assets": assets,
    }
    write_reports(manifest, reports_dir)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 1 if any(item["status"] != "mp4_ready" for item in assets) else 0


if __name__ == "__main__":
    raise SystemExit(main())
