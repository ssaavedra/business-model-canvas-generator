# Busup Canvas – Agent Briefing

Keep this document up to date so future sessions understand the current shape of the Busup Canvas web app, what assumptions are already satisfied, and how to react when new requirements arrive.

## Snapshot (Feb 2025)
- Framework: React + TypeScript via Vite, configured as a PWA with `vite-plugin-pwa`.
- Data source: `form-pages.json` in the repo root. The UI **imports this file directly**; do **not** inline or duplicate its content elsewhere.
- Primary component: `src/App.tsx` implements five form screens (plus summary), breadcrumbs, next/back actions, export to JSON, and drag/drop import.
- Styling: `src/App.css` for layout/components, `src/index.css` for globals. Visual identity uses gradients + pill breadcrumbs.
- Assets/config: PWA manifest in `vite.config.ts`, icon `public/pwa-icon.svg`, entry `src/main.tsx`.
- AI assist: The TAM/SAM/SOM screen now has a “Research using AI” action that calls Perplexity’s `chat/completions` endpoint (model `sonar-pro`). Prompts live in `prompts.json` (`tamsamsom`) and it requires `VITE_PERPLEXITY_API_KEY` in `.env` (see `.env.sample`).

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
