import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 4173);
const projectDir = path.resolve(process.env.DRAW_PROJECT_DIR || path.join(process.cwd(), "project"));
const resultsDir = path.join(projectDir, "results");
const projectFile = path.join(projectDir, "project.json");
const eventsFile = path.join(projectDir, "events.jsonl");
const commandsFile = path.join(projectDir, "commands.jsonl");

fs.mkdirSync(resultsDir, { recursive: true });
for (const file of [eventsFile, commandsFile]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
}

const emptyProject = () => ({
  version: 1,
  name: path.basename(projectDir),
  revision: 0,
  updatedAt: new Date().toISOString(),
  scene: { width: 1280, height: 720, objects: [] },
  graph: { nodes: [], edges: [] },
  results: [],
  lastPrompt: "",
});

if (!fs.existsSync(projectFile)) {
  fs.writeFileSync(projectFile, JSON.stringify(emptyProject(), null, 2));
}

app.use(express.json({ limit: "80mb" }));
app.use("/results", express.static(resultsDir));
app.get("/preview.png", (_req, res) => {
  const preview = path.join(projectDir, "preview.png");
  if (!fs.existsSync(preview)) return res.status(404).end();
  res.sendFile(preview);
});

function readProject() {
  try {
    return JSON.parse(fs.readFileSync(projectFile, "utf8"));
  } catch {
    return emptyProject();
  }
}

function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}

function appendJsonl(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function readJsonl(file, limit = 100) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function event(source, type, summary, payload = {}) {
  const item = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source,
    type,
    summary,
    payload,
  };
  appendJsonl(eventsFile, item);
  return item;
}

function dataUrlBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("Expected a base64 data URL");
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

function extFromMime(mime) {
  return mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
}

app.get("/api/project", (_req, res) => {
  const recentEvents = readJsonl(eventsFile, 500);
  const appliedSeq = recentEvents
    .filter((item) => item.type === "command-applied")
    .reduce((highest, item) => {
      const fromPayload = Number(item.payload?.seq || 0);
      const fromSummary = Number(String(item.summary || "").match(/#(\d+)/)?.[1] || 0);
      return Math.max(highest, fromPayload, fromSummary);
    }, 0);
  res.json({
    project: readProject(),
    events: recentEvents.slice(-80),
    apiReady: Boolean(process.env.OPENAI_API_KEY),
    previewReady: fs.existsSync(path.join(projectDir, "preview.png")),
    lastAppliedCommandSeq: appliedSeq,
    projectDir,
  });
});

app.get("/api/sync", (req, res) => {
  const after = Number(req.query.after || 0);
  const commands = readJsonl(commandsFile, 500).filter((item) => Number(item.seq || 0) > after);
  res.json({ commands, events: readJsonl(eventsFile, 80) });
});

app.post("/api/save", (req, res) => {
  const current = readProject();
  const incoming = req.body.project || {};
  const next = {
    ...current,
    ...incoming,
    revision: Number(current.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  atomicWrite(projectFile, JSON.stringify(next, null, 2));
  if (req.body.previewDataUrl) {
    fs.writeFileSync(path.join(projectDir, "preview.png"), dataUrlBuffer(req.body.previewDataUrl).buffer);
  }
  const saved = event(
    req.body.source === "codex" ? "codex" : "user",
    "scene-saved",
    `Saved ${next.scene?.objects?.length || 0} drawing objects`,
    { revision: next.revision },
  );
  res.json({ project: next, event: saved });
});

app.post("/api/event", (req, res) => {
  res.json(event(req.body.source || "user", req.body.type || "note", req.body.summary || "", req.body.payload || {}));
});

app.post("/api/generate", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: "OPENAI_API_KEY is not configured" });
  const { prompt, quality = "low", size = "1536x1024" } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });
  try {
    event("user", "gpt-requested", "Requested GPT Image 2 generation", { prompt, quality, size });
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-image-2", prompt, quality, size, output_format: "png" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI returned ${response.status}`);
    const output = Buffer.from(data.data?.[0]?.b64_json || "", "base64");
    if (!output.length) throw new Error("OpenAI returned no image");
    const filename = `${Date.now()}-generated.png`;
    fs.writeFileSync(path.join(resultsDir, filename), output);
    const result = { id: crypto.randomUUID(), url: `/results/${filename}`, prompt, quality, size, createdAt: new Date().toISOString() };
    const project = readProject();
    project.results = [...(project.results || []), result];
    project.lastPrompt = prompt;
    project.revision = Number(project.revision || 0) + 1;
    project.updatedAt = new Date().toISOString();
    atomicWrite(projectFile, JSON.stringify(project, null, 2));
    event("system", "gpt-completed", "GPT Image 2 generation completed", { resultId: result.id, filename });
    res.json({ result, project });
  } catch (error) {
    event("system", "gpt-failed", "GPT Image 2 generation failed", { error: String(error.message || error) });
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.post("/api/edit", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: "OPENAI_API_KEY is not configured" });
  const { prompt, imageDataUrl, maskDataUrl, quality = "low", size = "1536x1024" } = req.body;
  if (!prompt?.trim() || !imageDataUrl) return res.status(400).json({ error: "Prompt and image are required" });
  try {
    const image = dataUrlBuffer(imageDataUrl);
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("image[]", new Blob([image.buffer], { type: image.mime }), `canvas.${extFromMime(image.mime)}`);
    if (maskDataUrl) {
      const mask = dataUrlBuffer(maskDataUrl);
      form.append("mask", new Blob([mask.buffer], { type: mask.mime }), `mask.${extFromMime(mask.mime)}`);
    }
    form.append("prompt", prompt);
    form.append("quality", quality);
    form.append("size", size);
    form.append("output_format", "png");
    event("user", "gpt-requested", "Requested GPT Image 2 canvas edit", {
      prompt,
      quality,
      size,
      masked: Boolean(maskDataUrl),
    });
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI returned ${response.status}`);
    const output = Buffer.from(data.data?.[0]?.b64_json || "", "base64");
    if (!output.length) throw new Error("OpenAI returned no image");
    const filename = `${Date.now()}-edited.png`;
    fs.writeFileSync(path.join(resultsDir, filename), output);
    const result = { id: crypto.randomUUID(), url: `/results/${filename}`, prompt, quality, size, createdAt: new Date().toISOString() };
    const project = readProject();
    project.results = [...(project.results || []), result];
    project.lastPrompt = prompt;
    project.revision = Number(project.revision || 0) + 1;
    project.updatedAt = new Date().toISOString();
    atomicWrite(projectFile, JSON.stringify(project, null, 2));
    event("system", "gpt-completed", "GPT Image 2 edit completed", { resultId: result.id, filename });
    res.json({ result, project });
  } catch (error) {
    event("system", "gpt-failed", "GPT Image 2 edit failed", { error: String(error.message || error) });
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.use(express.static(path.join(process.cwd(), "dist")));
app.use((_req, res) => res.sendFile(path.join(process.cwd(), "dist", "index.html")));

app.listen(port, "127.0.0.1", () => {
  event("system", "server-started", `Draw opened on port ${port}`, { projectDir });
  console.log(`Draw listening on http://127.0.0.1:${port}`);
  console.log(`Project directory: ${projectDir}`);
});
