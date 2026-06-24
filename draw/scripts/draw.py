#!/usr/bin/env python3
"""Start and communicate with the Draw shared canvas."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parent.parent
APP_DIR = SKILL_DIR / "assets" / "app"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_project(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    (path / "results").mkdir(exist_ok=True)
    project = path / "project.json"
    if not project.exists():
        initial = {
            "version": 1,
            "name": path.name,
            "revision": 0,
            "updatedAt": now(),
            "scene": {"width": 1280, "height": 720, "objects": []},
            "graph": {"nodes": [], "edges": []},
            "results": [],
            "lastPrompt": "",
        }
        temp = project.with_suffix(".tmp")
        temp.write_text(json.dumps(initial, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(project)
    for filename in ("events.jsonl", "commands.jsonl"):
        (path / filename).touch(exist_ok=True)
    return path


def append_jsonl(path: Path, item: dict) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def read_jsonl(path: Path, limit: int = 20) -> list[dict]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    output = []
    for line in lines[-limit:]:
        try:
            output.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return output


def command_start(args: argparse.Namespace) -> int:
    project = ensure_project(Path(args.project).expanduser().resolve())
    if not (APP_DIR / "node_modules").exists():
        print("Installing Draw app dependencies...", flush=True)
        subprocess.run(["npm", "install"], cwd=APP_DIR, check=True)
    if not (APP_DIR / "dist" / "index.html").exists() or args.rebuild:
        print("Building Draw app...", flush=True)
        subprocess.run(["npm", "run", "build"], cwd=APP_DIR, check=True)

    env = os.environ.copy()
    env["DRAW_PROJECT_DIR"] = str(project)
    env["PORT"] = str(args.port)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Draw project: {project}")
    print(f"Open: {url}", flush=True)
    if args.open:
        webbrowser.open(url)
    return subprocess.call(["node", "server.mjs"], cwd=APP_DIR, env=env)


def command_status(args: argparse.Namespace) -> int:
    project_dir = ensure_project(Path(args.project).expanduser().resolve())
    project = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    output = {
        "project": str(project_dir),
        "revision": project.get("revision", 0),
        "updatedAt": project.get("updatedAt"),
        "objects": len(project.get("scene", {}).get("objects", [])),
        "results": project.get("results", []),
        "lastPrompt": project.get("lastPrompt", ""),
        "recentEvents": read_jsonl(project_dir / "events.jsonl", args.limit),
        "recentCommands": read_jsonl(project_dir / "commands.jsonl", args.limit),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


def command_send(args: argparse.Namespace) -> int:
    project_dir = ensure_project(Path(args.project).expanduser().resolve())
    payload = json.loads(args.json)
    commands = read_jsonl(project_dir / "commands.jsonl", 1)
    seq = int(commands[-1].get("seq", 0)) + 1 if commands else 1
    item = {
        "id": str(uuid.uuid4()),
        "seq": seq,
        "timestamp": now(),
        "source": "codex",
        "type": args.type,
        "payload": payload,
    }
    append_jsonl(project_dir / "commands.jsonl", item)
    append_jsonl(
        project_dir / "events.jsonl",
        {
            "id": str(uuid.uuid4()),
            "timestamp": now(),
            "source": "codex",
            "type": "command-sent",
            "summary": f"Sent canvas command: {args.type}",
            "payload": {"commandId": item["id"], "seq": seq},
        },
    )
    print(json.dumps(item, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Shared drawing canvas bridge for Codex.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start", help="Build and start the local canvas.")
    start.add_argument("--project", required=True)
    start.add_argument("--port", type=int, default=4173)
    start.add_argument("--open", action="store_true")
    start.add_argument("--rebuild", action="store_true")
    start.set_defaults(func=command_start)

    status = subparsers.add_parser("status", help="Read project state and recent history.")
    status.add_argument("--project", required=True)
    status.add_argument("--limit", type=int, default=12)
    status.set_defaults(func=command_status)

    send = subparsers.add_parser("command", help="Send a command to an open canvas.")
    send.add_argument("--project", required=True)
    send.add_argument("--type", required=True)
    send.add_argument("--json", default="{}")
    send.set_defaults(func=command_send)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\nDraw stopped.")
        return 130
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(f"draw: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
