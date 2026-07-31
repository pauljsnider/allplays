# Shared Assistant Core — Design

## Goal

Make the ChatGPT MCP service and the in-app AI chat run the **same assistant**:
the same tool set, the same planner reasoning, and — eventually — the same read
and write implementations. Single source of truth, no drift.

Directive: "I want this to work the same way the in-app AI chat works — all the
reads, all the writes, shared code." This realizes the plan's "reusable AllPlays
application service beneath MCP tools."

## The core constraint

The in-app AI (`apps/app/src/lib/privateAiService.ts`, 41 tools: 20 read, 21
write) reaches Firestore through a chain that bottoms out at the **browser
client Firebase SDK**:

```
privateAiService.ts → parentToolsService / scheduleService / homeService / …
  → adapters/legacy*.ts → @legacy/db.js → js/firebase.js: getFirestore(app)
```

That `db` is a signed-in browser client instance. The MCP server runs in Node
with the user's ID token over the Firestore **REST** API (rules-enforced, see
`firestoreRest.js`). So the two surfaces cannot literally share the data layer
today — the shared code currently *is* the client SDK.

## Architecture: platform-agnostic core + injected data client

Split the assistant into:

1. **`services/chatgpt-mcp/src/assistant-core/`** — pure, dependency-free ESM:
   the tool **contract** (`registry.js`: name, mode, description, aliases) and
   the **prompts** (`prompts.js`: planner + final-answer builders, summarizers).
   No Firebase, no platform. Consumed by both surfaces.
2. **Per-platform resolvers** — each surface supplies the `resolve(user, args)`
   for each tool against its own data transport: the app keeps its client-SDK
   services; the MCP uses the Firestore REST adapter.

### Why the shared core lives under the MCP src tree

The MCP deploys to Cloud Run by copying only `services/chatgpt-mcp/src`. Placing
the shared package there means it deploys with the service unchanged and Node
runs it directly (no build step). The app reaches it via a Vite alias
(`@assistant-core`), exactly the pattern it already uses for `@legacy → ../../js`.
The root vitest config mirrors the alias for app tests that run there. It can be
promoted to a top-level `packages/` workspace later if a bundling setup is added.

### Single source of truth + drift guard

`privateAiToolDefinitions` in the app stays the source of truth for the tool
contract. `scripts/gen-assistant-registry.mjs` lifts it (minus resolvers) into
`assistant-core/registry.js`. A `--check` mode (run in `assistant-core-shared`
tests) fails if the two diverge. The app's planner is built by the shared
builder but injected with the app's own live registry, so it can never lag its
own definitions.

## Phases

- **Phase 1 (done): shared contract + prompts.** Both surfaces import the shared
  registry and prompts. MCP tool descriptions come from the registry; the app
  imports the shared planner/final prompts + summarizers. Drift guard in CI.
- **Phase 2: reads through the shared core.** Port the app summarizers and add a
  server read-adapter so MCP returns the exact app shapes (practice sessions,
  assignments, rideshare, RSVP-fallback the spike omits). Reconcile the MCP's
  `get_game_summary` with the app's `get_last_game` / `get_player_stats`.
- **Phase 3: writes, one tool at a time.** Extend the REST adapter to writes
  (Firestore `commit` / batchWrite + field transforms) and route write tools +
  the pending-confirmation staging through the shared core, starting with
  `update_rsvp`, each with a parity test against the app path.
- **Phase 4 (optional): collapse the app onto the same injected-client
  interface** so there is a single resolver implementation everywhere.

## Testing

- `tests/unit/assistant-core-shared.test.js`: registry shape, alias resolution,
  prompt framing, custom-registry injection, and the generator drift guard.
- Fidelity is proven by the app's existing `app-private-ai-service.test.js`
  suite passing unchanged after the app adopts the shared prompts.
