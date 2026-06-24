---
name: draw
description: Open and operate a local shared drawing canvas connected to Codex, with React Flow workflow nodes, freehand drawing, shapes, text, image placement, masks, persistent step history, and GPT Image 2 generation or editing. Use when the user wants to sketch, annotate, compose, visually direct an image, watch Codex changes appear on a canvas, or iteratively edit an image with GPT Image.
---

# Draw

Use the bundled local app as the shared visual workspace. Keep source scenes, event history, prompts, masks, and generated results in the project directory so the user and Codex see the same state.

## Start a canvas

Choose a persistent project directory inside the current workspace, then run:

```bash
python3 scripts/draw.py start --project <project-dir>
```

Open the printed local URL in the in-app browser. Keep the server process running while collaborating.

## Collaborate with the canvas

Read the current scene, generated results, and recent user actions:

```bash
python3 scripts/draw.py status --project <project-dir>
```

Send a visible change to the open canvas:

```bash
python3 scripts/draw.py command --project <project-dir> \
  --type add-text \
  --json '{"text":"Move the logo here","x":180,"y":120,"color":"#e5484d"}'
```

Supported command types:

- `add-text`: add a text object; accepts `text`, `x`, `y`, `color`, and `fontSize`.
- `add-rect`: add a rectangle; accepts `x`, `y`, `width`, `height`, `color`, and `fill`.
- `add-ellipse`: add an ellipse with the same fields as `add-rect`.
- `add-arrow`: add an arrow; accepts `x`, `y`, `endX`, `endY`, and `color`.
- `set-prompt`: replace the GPT edit prompt; accepts `prompt`.
- `clear`: clear drawable objects.
- `note`: add a visible timeline note without changing the scene.

After sending a command, re-read status or inspect the browser to confirm the command was acknowledged. Do not modify `project.json`, `events.jsonl`, or `commands.jsonl` directly; use the script so writes remain atomic.

## Generate or edit

Require `OPENAI_API_KEY` in the server environment. Use `gpt-image-2` directly for both generation and edits. For a targeted edit, paint the affected region in Mask mode before submitting. The app sends a same-size PNG image and alpha mask to `/v1/images/edits`.

Use low quality for drafts and medium or high for selected finals. Preserve every returned result in the project `results/` directory and as a new result node.

## Inspect the protocol

Read [references/protocol.md](references/protocol.md) when changing the bridge, adding command types, or diagnosing synchronization.

## Validate

Before handing off:

1. Confirm the app builds.
2. Open it in the in-app browser.
3. Draw and save at least one object.
4. Send one Codex command and confirm it appears.
5. Confirm `project.json`, `events.jsonl`, `commands.jsonl`, `preview.png`, and result files persist.
6. Never commit API keys or generated user projects.
