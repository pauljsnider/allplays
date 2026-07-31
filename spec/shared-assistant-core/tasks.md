# Shared Assistant Core — Tasks

## Phase 1 — Shared contract + prompts (done)

- [x] 1. Create `services/chatgpt-mcp/src/assistant-core/` (registry.js, prompts.js, index.js, index.d.ts) — pure ESM, no platform deps.
- [x] 2. `scripts/gen-assistant-registry.mjs` — generate registry.js from the app's `privateAiToolDefinitions`; `--check` guards drift.
- [x] 3. MCP: source tool descriptions from the shared registry (`getToolDescriptor`).
- [x] 4. App: import the shared planner/final prompts + summarizers; `buildPlannerPrompt` injects the app's own live registry. Vite alias `@assistant-core`.
- [x] 5. Root vitest alias `@assistant-core` so root-level app tests resolve it.
- [x] 6. Tests: `assistant-core-shared.test.js` (registry, prompts, drift guard). App `app-private-ai-service.test.js` passes unchanged (fidelity).

## Phase 1 — remaining

- [ ] 7. Wire `gen-assistant-registry.mjs --check` into CI (alongside the existing rules/coverage checks).

## Phase 2 — Reads through the shared core

- [ ] 8. Extend the server data adapter (`firestoreRest.js`) to the read surface the app summarizers need.
- [ ] 9. Port the app `summarize*` helpers into `assistant-core` (pure over loaded data).
- [ ] 10. Implement MCP resolvers for the remaining read tools (`get_home`, `get_last_game`, `list_rsvps`, `get_messages`, `get_team_detail`, `get_player_stats`, …) using shared summarizers.
- [ ] 11. Reconcile `get_game_summary` with the app's `get_last_game` / `get_player_stats`.

## Phase 3 — Writes

- [ ] 12. Extend the REST adapter to writes: Firestore `commit` / batchWrite + field transforms (arrayUnion, serverTimestamp).
- [ ] 13. Route write tools + the pending-confirmation staging + audit through the shared core.
- [ ] 14. `update_rsvp` first, with a parity test against the app path; then the remaining 20 writes incrementally.

## Phase 4 — Optional convergence

- [ ] 15. Collapse the app onto the same injected-data-client interface so one resolver implementation backs both surfaces.
