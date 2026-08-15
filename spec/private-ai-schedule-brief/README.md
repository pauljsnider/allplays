# Private AI Schedule Brief Specifications

Status: Proposed

This folder defines the requirements, design boundaries, and implementation tasks for making schedule questions in Private AI accurate across every authorized team, player, and schedule source. The primary example is a parent asking, "What's the weekend look like?" and receiving one complete, timezone-correct brief rather than an answer based on the first event or team the assistant happens to find.

The enhancement replaces model-owned schedule reasoning with one server-authoritative schedule-brief capability. The language model interprets the request and may add a short introduction, while deterministic code resolves dates and scope, performs authorized bounded reads, tracks coverage, and renders every schedule fact.

## Product principles

- One schedule question should normally cause one typed schedule-brief tool call. Internal database fanout is not additional AI reasoning.
- Exact dates, weekdays, teams, players, event types, and completeness claims come from deterministic code, never model reconstruction.
- An unscoped family question includes every authorized team and linked player; it must not silently choose the first team.
- The exact current question overrides launcher context. The adapter carries both candidate question intent and reauthorized launcher context to the trusted resolver, which drops incompatible lower-precedence launcher selectors.
- Apply date, team, player, and event-type filters before display limits.
- Treat partial data as partial. An empty incomplete result can never prove that no event exists.
- Keep authorization and canonical identity resolution on a trusted server boundary.
- Use one domain implementation for the React app, packaged iOS and Android builds, and the ChatGPT MCP transport.
- Isolate external-calendar failures by team and source, retry only failed bounded reads, and tell the user what remains unverified.
- Keep writes and confirmations outside this read-only enhancement.

## Specification index

| # | Specification | Primary outcome | Depends on |
|---|---|---|---|
| 1 | [Temporal intent and schedule scope](./01-temporal-intent-scope.md) | Deterministic weekend/date and team/player/type resolution | Existing account, team, player, and launcher context |
| 2 | [Authoritative schedule-brief contract](./02-schedule-brief-contract.md) | One normalized request and evidence-bearing response | 1 |
| 3 | [Authorization, queries, and coverage](./03-authorization-queries-coverage.md) | Complete bounded reads with truthful partial-failure handling | 1, 2 |
| 4 | [AI orchestration and tool execution](./04-ai-orchestration-tools.md) | A thin model router over one typed server capability | 1–3 |
| 5 | [Application and MCP experience](./05-application-mcp-experience.md) | Consistent, deterministic answers in every supported client | 2–4 |
| 6 | [Verification, observability, and rollout](./06-verification-observability-rollout.md) | Regression coverage, budgets, staged delivery, and safe rollback | 1–5 |

## Current implementation boundary

The React app currently owns Private AI planning in `apps/app/src/lib/privateAiService.ts`, advertises many tools through a prose prompt, limits model tool rounds and calls, and asks the model to write the final answer. Its `list_schedule` path accepts a loose `range` string and loads the parent schedule before all natural-language date semantics are normalized.

Schedule aggregation in `apps/app/src/lib/scheduleService.ts` already supports bounded native game and practice queries and retains some successful events when another team or calendar fails. Its public result reduces that evidence to a broad `isPartial` flag, which cannot identify failed teams or sources or support a targeted retry.

The ChatGPT MCP service has a second schedule implementation in `services/chatgpt-mcp/src/core.js` and `services/chatgpt-mcp/src/server.js`. It accepts date bounds, but it duplicates authorization, aggregation, calendar projection, RSVP, and rendering behavior. This specification makes both transports call the same domain core.

## Delivery chunks

### Chunk 1: Contract and deterministic core

Implement specifications 1–3 behind typed interfaces. Add the temporal resolver, normalized event model, coverage ledger, bounded query adapters, and unit tests without changing the visible Private AI answer path.

### Chunk 2: Private AI application path

Implement specification 4 and the app portion of specification 5. Add the authenticated server flow, route schedule questions to it, render facts deterministically, and retain the previous path behind a rollback flag during validation.

### Chunk 3: Shared transports and operations

Move MCP schedule reads onto the shared core, complete specification 5 parity, then implement the shadow comparison, metrics, smoke coverage, staged rollout, and old-path retirement in specification 6.

## Estimated implementation scope

The expected broad change is 8–12 production or configuration files, 5–8 test files, 18–28 new or changed test cases, and roughly 1,500–3,000 changed lines across two or three pull requests. Adding Genkit as the initial server orchestration adapter may expand this to 12–18 production or configuration files, 7–10 test files, 25–38 cases, and roughly 2,500–4,500 changed lines. Migrating unrelated Private AI tools is explicitly outside this estimate.

## Production-safety applicability

Authorization, privacy, partial failure, deterministic limits, cache recovery, stale-state validation, and interrupted navigation apply and are specified throughout this folder. Confirmation bypass, persistent mutation atomicity, provider-side idempotency, destructive deletion, and external side-effect compensation are not applicable because this enhancement is read-only. Adding any write or provider mutation to the schedule-brief flow requires a separate safety design and confirmation contract.

## Cross-specification definition of done

Each implementation must include:

- A versioned request and response contract with inclusive start and exclusive end instants plus an IANA timezone.
- Server-authoritative authorization for the complete requested team and player scope.
- Database-bound date filtering, bounded concurrency, pagination evidence, and deterministic limits.
- Per-team and per-source coverage, truncation, retry, and `absenceConfirmed` evidence.
- Coverage-slice recovery that replaces completed source data, merges truncated slices only within verified coverage, retains only failed or unverified source facts as stale, and never leaves a removed event authoritative.
- Deterministic event fact rendering that cannot change the weekday, date, time, team, or location returned by the core.
- Equivalent React web, iOS, Android, and MCP behavior through one domain implementation.
- An MCP compatibility adapter for the existing inclusive `startDate` and `endDate` request schema during migration.
- Complete, partial-nonempty, partial-empty, legitimate-empty, ambiguity, timezone, and multi-team regressions.
- Structured metrics and sanitized logs without event titles, player names, emails, or raw prompts.
- A staged rollout and rollback plan that preserves the last complete user-visible state.
