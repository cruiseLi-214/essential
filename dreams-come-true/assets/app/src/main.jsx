import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  ArrowUpRight,
  Bot,
  Box,
  Circle,
  Download,
  Eraser,
  Image as ImageIcon,
  MousePointer2,
  Paintbrush,
  Pencil,
  Play,
  Save,
  Sparkles,
  Square,
  Type,
  Undo2,
  X,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./styles.css";

const WIDTH = 1280;
const HEIGHT = 720;
const COLORS = ["#171717", "#e5484d", "#2563eb", "#16a34a", "#f59e0b", "#ffffff"];
const uid = () => crypto.randomUUID();

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function DrawNode({ data }) {
  return (
    <div className="flow-node draw-node" onDoubleClick={data.onOpen}>
      <Handle type="target" position={Position.Left} />
      <div className="node-kicker"><Pencil size={13} /> Shared canvas</div>
      <strong>{data.label || "Drawing"}</strong>
      <div className="node-preview" onClick={data.onOpen}>
        {data.preview ? <img src={data.preview} alt="" /> : <span>Double-click to draw</span>}
      </div>
      <small>{data.objectCount || 0} objects · Codex linked</small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ResultNode({ data }) {
  return (
    <div className="flow-node result-node">
      <Handle type="target" position={Position.Left} />
      <div className="node-kicker"><Sparkles size={13} /> GPT Image 2</div>
      <img src={data.url} alt={data.prompt || "Generated result"} />
      <small title={data.prompt}>{data.prompt || "Generated result"}</small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { drawing: DrawNode, result: ResultNode };

function CanvasEditor({ scene, prompt, onPromptChange, onClose, onSave, onSubmit, busy, apiReady }) {
  const canvasRef = useRef(null);
  const imageCache = useRef(new Map());
  const [objects, setObjects] = useState(scene.objects || []);
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState("#171717");
  const [lineWidth, setLineWidth] = useState(8);
  const [active, setActive] = useState(null);
  const [history, setHistory] = useState([]);
  const [maskObjects, setMaskObjects] = useState(scene.maskObjects || []);
  const [quality, setQuality] = useState("low");
  const [error, setError] = useState("");

  useEffect(() => {
    setObjects(scene.objects || []);
    setMaskObjects(scene.maskObjects || []);
  }, [scene]);

  const setCurrentObjects = tool === "mask" ? setMaskObjects : setObjects;

  const drawObject = useCallback((ctx, object, mask = false) => {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = object.lineWidth || 5;
    ctx.strokeStyle = mask ? "rgba(255,255,255,1)" : object.color || "#171717";
    ctx.fillStyle = mask ? "rgba(255,255,255,1)" : object.fill || "transparent";
    if (object.type === "path" || object.type === "mask") {
      const points = object.points || [];
      if (points.length) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.stroke();
      }
    } else if (object.type === "rect") {
      if (object.fill && object.fill !== "transparent") ctx.fillRect(object.x, object.y, object.width, object.height);
      ctx.strokeRect(object.x, object.y, object.width, object.height);
    } else if (object.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(object.x + object.width / 2, object.y + object.height / 2, Math.abs(object.width / 2), Math.abs(object.height / 2), 0, 0, Math.PI * 2);
      if (object.fill && object.fill !== "transparent") ctx.fill();
      ctx.stroke();
    } else if (object.type === "arrow") {
      const angle = Math.atan2(object.endY - object.y, object.endX - object.x);
      ctx.beginPath();
      ctx.moveTo(object.x, object.y);
      ctx.lineTo(object.endX, object.endY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(object.endX, object.endY);
      ctx.lineTo(object.endX - 20 * Math.cos(angle - Math.PI / 6), object.endY - 20 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(object.endX - 20 * Math.cos(angle + Math.PI / 6), object.endY - 20 * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    } else if (object.type === "text") {
      ctx.font = `${object.fontSize || 34}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = object.color || "#171717";
      ctx.fillText(object.text || "Text", object.x, object.y);
    } else if (object.type === "image" && object.src) {
      let image = imageCache.current.get(object.src);
      if (!image) {
        image = new Image();
        image.src = object.src;
        image.onload = () => render();
        imageCache.current.set(object.src, image);
      }
      if (image.complete) ctx.drawImage(image, object.x, object.y, object.width, object.height);
    }
    ctx.restore();
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    objects.forEach((object) => drawObject(ctx, object));
    if (active && tool !== "mask") drawObject(ctx, active);
    maskObjects.forEach((object) => {
      ctx.save();
      ctx.globalAlpha = 0.36;
      drawObject(ctx, { ...object, color: "#ef4444" });
      ctx.restore();
    });
    if (active && tool === "mask") {
      ctx.save();
      ctx.globalAlpha = 0.45;
      drawObject(ctx, { ...active, color: "#ef4444" });
      ctx.restore();
    }
  }, [active, drawObject, maskObjects, objects, tool]);

  useEffect(() => render(), [render]);

  const pos = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT };
  };

  const begin = (event) => {
    if (tool === "select") return;
    const point = pos(event);
    setHistory((items) => [...items, { objects, maskObjects }].slice(-30));
    if (tool === "text") {
      const text = window.prompt("Text");
      if (text) setObjects((items) => [...items, { id: uid(), type: "text", text, x: point.x, y: point.y, color, fontSize: 40 }]);
      return;
    }
    if (tool === "eraser") {
      const nearest = objects.map((item, index) => ({ index, distance: Math.hypot((item.x || item.points?.[0]?.x || 0) - point.x, (item.y || item.points?.[0]?.y || 0) - point.y) })).sort((a, b) => a.distance - b.distance)[0];
      if (nearest && nearest.distance < 120) setObjects((items) => items.filter((_, index) => index !== nearest.index));
      return;
    }
    if (tool === "pencil" || tool === "mask") {
      setActive({ id: uid(), type: tool === "mask" ? "mask" : "path", points: [point], color, lineWidth: tool === "mask" ? Math.max(20, lineWidth * 3) : lineWidth });
    } else {
      setActive({ id: uid(), type: tool, x: point.x, y: point.y, endX: point.x, endY: point.y, width: 0, height: 0, color, lineWidth });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event) => {
    if (!active) return;
    const point = pos(event);
    if (active.type === "path" || active.type === "mask") setActive({ ...active, points: [...active.points, point] });
    else if (active.type === "arrow") setActive({ ...active, endX: point.x, endY: point.y });
    else setActive({ ...active, width: point.x - active.x, height: point.y - active.y });
  };

  const end = () => {
    if (!active) return;
    setCurrentObjects((items) => [...items, active]);
    setActive(null);
  };

  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    setObjects(last.objects);
    setMaskObjects(last.maskObjects);
    setHistory((items) => items.slice(0, -1));
  };

  const importImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(WIDTH / image.width, HEIGHT / image.height, 0.75);
        setObjects((items) => [...items, { id: uid(), type: "image", src: reader.result, x: (WIDTH - image.width * scale) / 2, y: (HEIGHT - image.height * scale) / 2, width: image.width * scale, height: image.height * scale }]);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const flattened = () => {
    render();
    return canvasRef.current.toDataURL("image/png");
  };

  const maskData = () => {
    if (!maskObjects.length) return null;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalCompositeOperation = "destination-out";
    maskObjects.forEach((object) => drawObject(ctx, object, true));
    return canvas.toDataURL("image/png");
  };

  const save = async () => {
    setError("");
    try { await onSave({ width: WIDTH, height: HEIGHT, objects, maskObjects }, flattened()); }
    catch (err) { setError(err.message); }
  };

  const submit = async (mode) => {
    setError("");
    try {
      await onSubmit({ mode, prompt, quality, size: "1280x720", imageDataUrl: flattened(), maskDataUrl: maskData(), scene: { width: WIDTH, height: HEIGHT, objects, maskObjects } });
    } catch (err) { setError(err.message); }
  };

  const tools = [
    ["select", MousePointer2, "Select"], ["pencil", Pencil, "Pencil"], ["rect", Square, "Rectangle"],
    ["ellipse", Circle, "Ellipse"], ["arrow", ArrowUpRight, "Arrow"], ["text", Type, "Text"],
    ["eraser", Eraser, "Erase object"], ["mask", Paintbrush, "GPT edit mask"],
  ];

  return (
    <div className="editor-shell">
      <div className="editor-topbar">
        <div><strong>Draw canvas</strong><span>Every save and GPT result is visible to Codex</span></div>
        <div className="top-actions">
          <button onClick={undo} disabled={!history.length}><Undo2 size={16} /> Undo</button>
          <button onClick={save}><Save size={16} /> Save</button>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
      </div>
      <div className="editor-body">
        <aside className="tool-rail">
          {tools.map(([name, Icon, title]) => <button key={name} className={tool === name ? "active" : ""} onClick={() => setTool(name)} title={title}><Icon size={19} /><span>{title}</span></button>)}
          <label className="upload-button" title="Import image"><ImageIcon size={19} /><span>Image</span><input type="file" accept="image/*" onChange={importImage} /></label>
        </aside>
        <main className="canvas-stage">
          <div className="canvas-meta"><span>{WIDTH} × {HEIGHT}</span><span>{objects.length} objects</span>{maskObjects.length > 0 && <span className="mask-badge">{maskObjects.length} mask strokes</span>}</div>
          <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
          <div className="style-bar">
            <div className="color-list">{COLORS.map((item) => <button key={item} style={{ background: item }} className={color === item ? "selected" : ""} onClick={() => setColor(item)} />)}</div>
            <label>Stroke <input type="range" min="2" max="40" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label>
            <button onClick={() => { setHistory((items) => [...items, { objects, maskObjects }]); setObjects([]); setMaskObjects([]); }}>Clear</button>
          </div>
        </main>
        <aside className="prompt-panel">
          <div className="panel-title"><Bot size={18} /> GPT Image 2</div>
          <p>Describe the final result. Paint red areas in Mask mode for targeted changes.</p>
          <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Turn this rough layout into a polished editorial illustration..." />
          <label>Quality<select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="low">Low · draft</option><option value="medium">Medium</option><option value="high">High · final</option></select></label>
          {!apiReady && <div className="warning">Start the app with OPENAI_API_KEY to enable generation.</div>}
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy || !apiReady || !prompt.trim()} onClick={() => submit("edit")}><Sparkles size={17} /> {busy ? "Working…" : "Edit this canvas"}</button>
          <button disabled={busy || !apiReady || !prompt.trim()} onClick={() => submit("generate")}><Play size={17} /> Generate without canvas</button>
          <small>Model is fixed to gpt-image-2. Files and steps stay in the project folder.</small>
        </aside>
      </div>
    </div>
  );
}

function Timeline({ events }) {
  return (
    <aside className="timeline"><div className="timeline-title"><Box size={16} /> Shared history</div><div className="timeline-list">
      {[...events].reverse().map((event) => <div className={`event ${event.source}`} key={event.id}><div><span>{event.source}</span><time>{new Date(event.timestamp).toLocaleTimeString()}</time></div><p>{event.summary}</p></div>)}
    </div></aside>
  );
}

function Workspace() {
  const [project, setProject] = useState(null);
  const [events, setEvents] = useState([]);
  const [apiReady, setApiReady] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [projectDir, setProjectDir] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSeq, setLastSeq] = useState(0);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const load = useCallback(async () => {
    const data = await api("/api/project");
    setProject(data.project);
    setEvents(data.events || []);
    setApiReady(data.apiReady);
    setPreviewReady(data.previewReady);
    setProjectDir(data.projectDir);
    setLastSeq(Number(data.lastAppliedCommandSeq || data.project.lastCommandSeq || 0));
  }, []);

  useEffect(() => { load().catch((err) => setError(err.message)); }, [load]);
  const openEditor = useCallback(() => setEditorOpen(true), []);

  useEffect(() => {
    if (!project) return;
    const drawing = { id: "drawing", type: "drawing", position: project.graph?.nodes?.find((node) => node.id === "drawing")?.position || { x: 80, y: 180 }, data: { label: project.name, preview: previewReady ? `/preview.png?rev=${project.revision}` : null, objectCount: project.scene?.objects?.length || 0, onOpen: openEditor } };
    const resultNodes = (project.results || []).map((result, index) => ({ id: result.id, type: "result", position: project.graph?.nodes?.find((node) => node.id === result.id)?.position || { x: 430 + index * 320, y: 150 + (index % 2) * 260 }, data: result }));
    setNodes([drawing, ...resultNodes]);
    setEdges(resultNodes.map((node) => ({ id: `drawing-${node.id}`, source: "drawing", target: node.id })));
  }, [openEditor, previewReady, project, setEdges, setNodes]);

  const applyCommand = useCallback((command) => {
    setProject((current) => {
      if (!current) return current;
      const payload = command.payload || {};
      let objects = [...(current.scene?.objects || [])];
      let lastPrompt = current.lastPrompt || "";
      const base = { id: uid(), color: payload.color || "#e5484d", lineWidth: payload.lineWidth || 6 };
      if (command.type === "add-text") objects.push({ ...base, type: "text", text: payload.text || "Codex note", x: payload.x ?? 160, y: payload.y ?? 120, fontSize: payload.fontSize || 40 });
      if (command.type === "add-rect") objects.push({ ...base, type: "rect", x: payload.x ?? 160, y: payload.y ?? 120, width: payload.width || 260, height: payload.height || 160, fill: payload.fill || "transparent" });
      if (command.type === "add-ellipse") objects.push({ ...base, type: "ellipse", x: payload.x ?? 160, y: payload.y ?? 120, width: payload.width || 220, height: payload.height || 160, fill: payload.fill || "transparent" });
      if (command.type === "add-arrow") objects.push({ ...base, type: "arrow", x: payload.x ?? 160, y: payload.y ?? 120, endX: payload.endX ?? 420, endY: payload.endY ?? 240 });
      if (command.type === "set-prompt") lastPrompt = payload.prompt || "";
      if (command.type === "clear") objects = [];
      return { ...current, scene: { ...(current.scene || {}), objects }, lastPrompt, lastCommandSeq: Math.max(Number(current.lastCommandSeq || 0), Number(command.seq || 0)) };
    });
    setLastSeq((value) => Math.max(value, Number(command.seq || 0)));
  }, []);

  useEffect(() => {
    if (!project) return undefined;
    const timer = setInterval(async () => {
      try {
        const data = await api(`/api/sync?after=${lastSeq}`);
        if (data.commands?.length) {
          data.commands.forEach(applyCommand);
          const highest = Math.max(...data.commands.map((item) => Number(item.seq || 0)));
          setTimeout(async () => {
            setProject((current) => {
              if (!current) return current;
              api("/api/save", { method: "POST", body: JSON.stringify({ project: current, source: "codex" }) }).then((response) => setProject(response.project)).catch(() => {});
              return current;
            });
            await api("/api/event", { method: "POST", body: JSON.stringify({ source: "codex", type: "command-applied", summary: `Canvas applied Codex command #${highest}`, payload: { seq: highest } }) });
          }, 80);
        }
        setEvents(data.events || []);
      } catch {
        // Keep the current canvas usable during a temporary sync failure.
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [applyCommand, lastSeq, project]);

  const saveProject = async (scene, previewDataUrl) => {
    const graph = { nodes: nodes.map(({ id, type, position }) => ({ id, type, position })), edges };
    const data = await api("/api/save", { method: "POST", body: JSON.stringify({ project: { ...project, scene, graph }, previewDataUrl, source: "user" }) });
    setProject(data.project);
    setPreviewReady((current) => Boolean(previewDataUrl) || current);
    setEvents((items) => [...items, data.event]);
  };

  const submit = async ({ mode, scene, ...payload }) => {
    setBusy(true);
    try {
      await saveProject(scene, payload.imageDataUrl);
      const data = await api(mode === "generate" ? "/api/generate" : "/api/edit", { method: "POST", body: JSON.stringify(payload) });
      setProject(data.project);
      await load();
      setEditorOpen(false);
    } finally { setBusy(false); }
  };

  const downloadPreview = () => {
    const anchor = document.createElement("a");
    anchor.href = "/preview.png";
    anchor.download = `${project?.name || "draw"}.png`;
    anchor.click();
  };

  if (!project) return <div className="loading">Opening Draw…</div>;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><div className="brand-mark"><Pencil size={19} /></div><div><strong>Draw</strong><span>Codex-linked visual workspace</span></div></div>
        <div className="header-meta"><span className={apiReady ? "ready" : "offline"}>{apiReady ? "GPT Image 2 ready" : "API key needed"}</span><code title={projectDir}>{project.name}</code></div>
        <div className="header-actions"><button onClick={downloadPreview}><Download size={16} /> PNG</button><button className="primary" onClick={() => setEditorOpen(true)}><Pencil size={16} /> Open canvas</button></div>
      </header>
      <div className="workspace">
        <main className="flow-area">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={(connection) => setEdges((items) => addEdge(connection, items))} fitView minZoom={0.35}>
            <Background color="#d7d0c5" gap={24} size={1.2} /><MiniMap pannable zoomable nodeColor={(node) => node.type === "drawing" ? "#d97757" : "#215f4d"} /><Controls />
          </ReactFlow>
          <div className="flow-hint">Double-click the canvas node to draw. GPT results return as connected nodes.</div>
          {error && <div className="global-error">{error}</div>}
        </main>
        <Timeline events={events} />
      </div>
      {editorOpen && <CanvasEditor scene={project.scene || { width: WIDTH, height: HEIGHT, objects: [] }} prompt={project.lastPrompt || ""} onPromptChange={(lastPrompt) => setProject((current) => ({ ...current, lastPrompt }))} onClose={() => setEditorOpen(false)} onSave={saveProject} onSubmit={submit} busy={busy} apiReady={apiReady} />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<React.StrictMode><ReactFlowProvider><Workspace /></ReactFlowProvider></React.StrictMode>);
