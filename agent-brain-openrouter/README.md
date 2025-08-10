# agent-brain-openrouter

Planner mínimo que usa **OpenRouter + Gemini 2.5 Flash-Lite** para generar pasos de navegación y llama a tu **agent-runner** para ejecutarlos sobre Browserless.

## Endpoints
- `GET /healthz` → `{ ok: true }`
- `POST /plan`  → body: `{ "goal":"...", "startUrl":"https://..." }` ⇒ devuelve `{ steps:[...] }`
- `POST /solve` → planifica + ejecuta (POST al `/run` de agent-runner)

## Variables de entorno
- `OPENROUTER_API_KEY`  → tu clave de OpenRouter
- `OPENROUTER_MODEL`    → por defecto: `google/gemini-2.5-flash-lite`
- `OPENROUTER_BASE`     → por defecto: `https://openrouter.ai/api/v1`
- `OPENROUTER_REFERER`  → (opcional) URL de tu app para atribución
- `OPENROUTER_TITLE`    → (opcional) nombre de tu app para rankings
- `AGENT_RUNNER_URL`    → URL interna o pública del agent-runner (ej.: `http://whatsap_agent-runner`)

## Despliegue en EasyPanel (Buildpacks)
- Runtime: **Node 20**
- Build command: `npm install`
- Start command: `npm start`
- Internal port: `3000`
- Env vars:
  - `OPENROUTER_API_KEY=...`
  - `AGENT_RUNNER_URL=http://whatsap_agent-runner`
  - (Opc) `OPENROUTER_REFERER=https://tudominio.com`
  - (Opc) `OPENROUTER_TITLE=Mi Agente Navegador`
  - (Opc) `OPENROUTER_MODEL=google/gemini-2.5-flash-lite`

## cURL de prueba (red interna)

```bash
# Salud
curl -s http://whatsap_agent-brain:3000/healthz

# Plan (solo genera los pasos; no ejecuta)
curl -s -X POST http://whatsap_agent-brain:3000/plan   -H 'Content-Type: application/json'   -d '{
    "goal":"Ir a https://example.com y abrir “More information”, luego dame el título",
    "startUrl":"https://example.com"
  }' | jq .

# Solve (planifica y ejecuta con agent-runner)
curl -s -X POST http://whatsap_agent-brain:3000/solve   -H 'Content-Type: application/json'   -d '{
    "goal":"Ir a https://example.com y abrir “More information”, luego devuélveme el texto principal",
    "startUrl":"https://example.com"
  }' | jq .
```
