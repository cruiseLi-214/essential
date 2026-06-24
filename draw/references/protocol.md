# Draw bridge protocol

## Project files

Each canvas project is an ordinary directory:

```text
project/
├── project.json
├── events.jsonl
├── commands.jsonl
├── preview.png
└── results/
```

- `project.json` is the latest materialized scene and workflow state.
- `events.jsonl` is an append-only audit trail of user, Codex, and system actions.
- `commands.jsonl` is an append-only queue written by `scripts/draw.py command`.
- `preview.png` is the latest flattened drawing.
- `results/` contains immutable GPT Image outputs.

## Synchronization

The browser polls `/api/sync` every 1.5 seconds. The response includes commands newer than the browser's last acknowledged sequence and recent events. After applying a command, the browser posts an acknowledgement event and saves the updated scene.

Every command has:

```json
{
  "id": "uuid",
  "seq": 1,
  "timestamp": "ISO-8601",
  "source": "codex",
  "type": "add-text",
  "payload": {}
}
```

The server uses atomic rename for `project.json` and append-only writes for JSONL files. The browser is the scene authority while open; Codex communicates through commands instead of editing materialized state.

## Event schema

```json
{
  "id": "uuid",
  "timestamp": "ISO-8601",
  "source": "user|codex|system",
  "type": "scene-saved",
  "summary": "Saved 4 drawing objects",
  "payload": {}
}
```

Do not put API keys, image bytes, or full data URLs in events. Store image bytes in files and reference their relative paths.

## GPT Image 2

- Generation endpoint: `POST https://api.openai.com/v1/images/generations`
- Edit endpoint: `POST https://api.openai.com/v1/images/edits`
- Edit uploads use multipart fields `model=gpt-image-2`, `image[]`, optional `mask`, `prompt`, `quality`, and `size`.
- Image and mask must have identical dimensions and format. Masks must contain an alpha channel.
