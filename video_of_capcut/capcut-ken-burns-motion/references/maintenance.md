# Maintenance Notes

Use this reference when updating the skill after repeated real jobs.

## Update Criteria

- Update defaults only when repeated usage shows the same adjustment is needed.
- Add a new preset only when it solves a recurring workflow, such as vertical shorts, quote-heavy slides, or dense diagrams.
- Do not remove strict verification: count, resolution, duration, fps, and checksums remain mandatory.
- Keep ffmpeg project-local unless the user explicitly asks for a system install.

## Versioning Pattern

- Commit skill changes with messages like `Update CapCut Ken Burns motion skill`.
- If replacing an existing GitHub version, update `SKILL.md`, `agents/openai.yaml`, `scripts/render_capcut_ken_burns.py`, and this file together.
- Prefer a branch or pull request for major behavior changes such as new crop logic, vertical default, audio support, or batch concatenation.

## Suggested Review Cadence

- Light use: update only when a specific pain point appears.
- Frequent use: review once per month or after 5-10 completed image-to-motion batches.
- Heavy production use: track common overrides and promote stable ones into script arguments or defaults.
