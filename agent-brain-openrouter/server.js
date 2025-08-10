import express from "express";
import axios from "axios";
import 'dotenv/config';

const app = express();
app.use(express.json({ limit: "1mb" }));

// === ENV ===
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-lite";
const OPENROUTER_BASE = process.env.OPENROUTER_BASE || "https://openrouter.ai/api/v1";
const OPENROUTER_REFERER = process.env.OPENROUTER_REFERER || ""; // optional but recommended
const OPENROUTER_TITLE = process.env.OPENROUTER_TITLE || "Agent Brain (OpenRouter)";

const AGENT_RUNNER_URL = (process.env.AGENT_RUNNER_URL || "http://whatsap_agent-runner").replace(/\/$/, "");

if (!OPENROUTER_API_KEY) {
  console.warn("[agent-brain-openrouter] WARNING: OPENROUTER_API_KEY is not set.");
}
if (!AGENT_RUNNER_URL) {
  throw new Error("AGENT_RUNNER_URL is required");
}

const SYSTEM_PROMPT = `Eres un planificador de acciones web para un navegador controlado por API.
Responde SOLO con JSON válido con este esquema:
{
  "steps": [
    { "action": "goto|click|type|press|wait|extract|screenshot|done", "target": "<css|text=...|role=role:nombre>", "value": "<texto|tecla|selector|ms opcional>" }
  ]
}
Reglas:
- Máximo 12 pasos.
- Si se proporciona startUrl, el primer paso DEBE ser {"action":"goto","target":"<startUrl>"}.
- Usa "text=" cuando el objetivo sea un texto visible (ej. "text=More information").
- En "type", pon el selector en "target" y el texto en "value".
- Añade SIEMPRE una extracción al final (ej.: {"action":"extract","target":"body","value":"text"}).
- Solo añade "screenshot" si el usuario lo pide.
- Termina con {"action":"done","target":"","value":"<breve resumen>"}.
`;

function ensureJson(obj) {
  if (!obj || typeof obj !== "object") throw new Error("No JSON");
  if (!Array.isArray(obj.steps)) throw new Error("Falta 'steps'");
  for (const s of obj.steps) {
    if (!s.action) throw new Error("Paso sin 'action'");
    s.action = String(s.action).toLowerCase();
    s.target = s.target ?? "";
    if (s.value === undefined) s.value = "";
  }
  return obj;
}

async function chatPlan({ goal, startUrl = "" }) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Objetivo: ${goal}${startUrl ? `\nstartUrl: ${startUrl}` : ""}` }
  ];

  const headers = {
    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (OPENROUTER_REFERER) headers["HTTP-Referer"] = OPENROUTER_REFERER;
  if (OPENROUTER_TITLE) headers["X-Title"] = OPENROUTER_TITLE;

  const body = {
    model: OPENROUTER_MODEL,
    messages,
    temperature: 0.2,
    response_format: { type: "json_object" }
  };

  const url = `${OPENROUTER_BASE}/chat/completions`;
  const resp = await axios.post(url, body, { headers, timeout: 60000 });
  const txt = resp.data?.choices?.[0]?.message?.content || "{}";
  let json;
  try {
    json = JSON.parse(txt);
  } catch (e) {
    // intenta rescatar JSON del texto
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) json = JSON.parse(m[0]);
    else throw new Error("El modelo no devolvió JSON válido");
  }
  json = ensureJson(json);
  json.steps = json.steps.slice(0, 12);
  return json;
}

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.post("/plan", async (req, res) => {
  try {
    const { goal, startUrl = "" } = req.body || {};
    if (!goal) return res.status(400).json({ ok: false, error: "goal is required" });
    const plan = await chatPlan({ goal, startUrl });
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.post("/solve", async (req, res) => {
  try {
    const { goal, startUrl = "" } = req.body || {};
    if (!goal) return res.status(400).json({ ok: false, error: "goal is required" });

    const plan = await chatPlan({ goal, startUrl });

    // Ejecutar plan en agent-runner
    const run = await axios.post(`${AGENT_RUNNER_URL}/run`, plan, { timeout: 120000 });
    res.json({ ok: true, plan, result: run.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[agent-brain-openrouter] listening on ${PORT}`));
