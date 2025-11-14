# Busup Canvas – Agent Briefing

Keep this document up to date so future sessions understand the current shape of the Busup Canvas web app, what assumptions are already satisfied, and how to react when new requirements arrive.

## Snapshot (Feb 2025)
- Framework: React + TypeScript via Vite, configured as a PWA with `vite-plugin-pwa`.
- Data source: `form-pages.json` in the repo root. The UI **imports this file directly**; do **not** inline or duplicate its content elsewhere.
- Primary component: `src/App.tsx` implements seven form screens (Ficha, Business Model Canvas, DAFO, TAM/SAM/SOM, Lista de Competidores, Análisis Porter, One-pager) más el resumen, breadcrumbs, next/back actions, export to JSON, y drag/drop import.
- Input UX: `Estado` is a discrete radio-pills selector (Idea/Prototipo/Ventas iniciales/Escala) and every other answer uses a Markdown editor with preview-on-blur (powered by `marked` + `dompurify`).
- Styling: `src/App.css` for layout/components, `src/index.css` for globals. Visual identity uses gradients + pill breadcrumbs.
- Assets/config: PWA manifest in `vite.config.ts`, icon `public/pwa-icon.svg`, entry `src/main.tsx`.
- AI assist: The TAM/SAM/SOM, LISTA DE COMPETIDORES, ANÁLISIS PORTER y ONE PAGER screens expose a "Research using AI" / "Analizar con IA" action powered by Perplexity's `chat/completions`. TAM/SAM/SOM, Competidores and Porter use `sonar-pro`, while the One-pager  y el nuevo “Pre-rellenar con IA” del primer paso usan `sonar-reasoning-pro`. Prompts live in `prompts.json` (`tamsamsom`, `competitors`, `porter`, `onepager`, `prefill`) and it requires `VITE_PERPLEXITY_API_KEY` in `.env` (see `.env.sample`).

## Typical Workflow
1. Install deps with `npm install`.
2. Dev server `npm run dev`, build `npm run build`, preview `npm run preview`.
3. All collected answers round-trip through `busup-canvas.json` downloads. When testing import, drag the file onto the window or use the “Cargar archivo” button.

## Change Policy for This File
- Update **Snapshot** whenever frameworks, architecture pieces, or critical files change (new routes, new data sources, different styling approach, etc.).
- Document any new cross-cutting requirements (e.g., authentication, AI integrations, persistence upgrades) as soon as they are implemented or strongly committed.
- If you remove/rename major files referenced here, reflect that immediately and note migration steps so other agents do not rely on stale instructions.
- When responding to new requests that alter the high-level flow (pages, navigation behavior, export format), append a dated bullet or short paragraph summarizing what changed and why.

Treat AGENTS.md as the shared memory for multi-session work: concise, essential, and always fresh. Remove outdated details rather than letting them rot—future agents depend on it.

## Updates
- Feb 2025: Added Markdown editor + preview for every field except Estado, and converted Estado into radio pills so users pick a defined stage.
- Mar 2025: Added ONE PAGER step with AI-powered one-pager generation using sonar-reasoning-pro fed by prompts in `prompts.json`.
- Mar 2025: First screen now accepts unstructured briefs in Markdown and can “Pre-rellenar con IA” todos los campos basándose en ese contenido; la petición usa el prompt `prefill` y el modelo `sonar-reasoning-pro`.
- Mar 2025: Added ANÁLISIS PORTER step between Lista de Competidores and One-pager with AI-powered Porter's 5 Forces analysis covering: client power, supplier power, substitutes threat, new entrants threat, and competitive rivalry.

