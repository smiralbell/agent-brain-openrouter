import express from "express";
import { chromium } from "playwright-core";

const app = express();
app.use(express.json({ limit: "1mb" }));

// URL WS/WSS de tu Browserless, p.ej.:
//   ws://whatsap_browserless:3000?token=TU_TOKEN   (interna)
//   wss://tu-browserless.dominio?token=TU_TOKEN    (pública con SSL)
const WSS  = process.env.BROWSERLESS_WSS;
const PORT = process.env.PORT || 3000;

if (!WSS) {
  console.warn("[agent-runner] WARNING: BROWSERLESS_WSS is not set");
}

// --------- Helpers ----------
function locator(page, target = "") {
  if (!target) return page.locator("body");

  // text=Visible text (parcial)
  if (target.startsWith("text=")) {
    const t = target.slice(5).trim();
    return page.getByText(t, { exact: false });
  }

  // role=button:Login  | role=link:More information
  if (target.startsWith("role=")) {
    const [, rest] = target.split("=");
    const [role, name = ""] = rest.split(":");
    return page.getByRole(role.trim(), { name: name.trim() || undefined });
  }

  // CSS directo: #id, .clase, input[name=q], etc.
  return page.locator(target);
}

// --------- Core runner (con trace) ----------
async function runSteps(steps = [], trace = false) {
  if (!Array.isArray(steps)) throw new Error("steps must be an array");
  if (!WSS) throw new Error("BROWSERLESS_WSS is not set");

  const browser  = await chromium.connectOverCDP(WSS);
  const page     = await browser.newPage();
  const outputs  = [];
  const timeline = [];     // capturas y metadatos por paso

  try {
    for (let i = 0; i < steps.length; i++) {
      const s       = steps[i] || {};
      const action  = String(s.action || "").toLowerCase();
      const target  = s.target || "";
      const value   = s.value ?? "";
      const t0      = Date.now();

      switch (action) {
        case "goto":
          await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
          break;

        case "click":
          await locator(page, target).first().click({ timeout: 15000 });
          break;

        case "type":
          await locator(page, target).first().fill(String(value));
          break;

        case "press":
          await page.keyboard.press(String(value || "Enter"));
          break;

        case "wait":
          if (typeof value === "number") {
            await page.waitForTimeout(value);
          } else if (typeof value === "string" && value.trim()) {
            await locator(page, value).first().waitFor({ state: "visible", timeout: 20000 });
          } else {
            await page.waitForTimeout(1000);
          }
          break;

        case "extract": {
          const mode = (String(value) || "text").toLowerCase(); // "text" | "html"
          const result = await locator(page, target).first().evaluate((el, m) => {
            if (!el) return null;
            if (m === "html") return el.outerHTML;
            return el.innerText || el.textContent || "";
          }, mode);
          outputs.push({ action, target, mode, result });
          break;
        }

        case "screenshot": {
          let buf;
          if (target && target.trim()) {
            const el = locator(page, target).first();
            await el.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
            buf = await el.screenshot({ type: "png" });
          } else {
            buf = await page.screenshot({ fullPage: true, type: "png" });
          }
          outputs.push({ action, target, type: "png", base64: buf.toString("base64") });
          break;
        }

        default:
          outputs.push({ action, error: "Acción desconocida" });
      }

      // Deja que asiente la UI tras acciones que cambian la página
      if (["goto", "click", "type", "press"].includes(action)) {
        try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}
      }

      // ----- TRACE: captura después de cada paso -----
      if (trace) {
        let shotB64 = "";
        try {
          const buf = await page.screenshot({ fullPage: true, type: "png" });
          shotB64 = buf.toString("base64");
        } catch {}
        timeline.push({
          i,
          action,
          target,
          value: typeof value === "string" ? value.slice(0, 120) : value,
          url: page.url(),
          title: await page.title(),
          elapsedMs: Date.now() - t0,
          screenshotBase64: shotB64
        });
      }
    }

    const title = await page.title();
    const url   = page.url();
    await browser.close();
    return { ok: true, url, title, outputs, timeline: trace ? timeline : undefined };
  } catch (e) {
    await browser.close();
    return { ok: false, error: e.message, outputs, timeline: trace ? timeline : undefined };
  }
}

// --------- HTTP API ----------
app.post("/run", async (req, res) => {
  try {
    const { steps, trace = false } = req.body || {};
    if (!Array.isArray(steps)) return res.status(400).json({ ok: false, error: "steps must be an array" });
    const result = await runSteps(steps, !!trace);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`agent-runner listening on ${PORT}`);
});
