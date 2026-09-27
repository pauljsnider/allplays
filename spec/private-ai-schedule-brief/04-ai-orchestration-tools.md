# AI Orchestration and Tool Execution

Status: Proposed

Depends on: [Temporal intent and schedule scope](./01-temporal-intent-scope.md), [authoritative schedule-brief contract](./02-schedule-brief-contract.md), [authorization, queries, and coverage](./03-authorization-queries-coverage.md)

## Objective

Use AI for bounded intent routing while keeping schedule correctness, authorization, database execution, retries, and factual rendering in deterministic server code.

## Requirements

1. Private AI exposes one typed read tool, `get_schedule_brief`, for multi-team schedule questions. The tool accepts the adapter envelope containing typed current-question candidate intent and authenticated launcher context; trusted server code resolves it into the normalized schedule-brief request and returns the authoritative response contract.
2. A normal schedule question uses one model routing step and one schedule tool call. Internal parallel source reads and targeted retries do not consume additional model turns.
3. A second model-selected tool call is allowed only when the current question genuinely requests another domain action, such as combining a schedule brief with a message or task query.
4. The model cannot request raw Firestore paths, arbitrary collection scans, provider URLs, or an unauthorized expansion of resolved team/player scope.
5. Current-question and launcher scope resolution runs deterministically even if the planner omits selectors or emits a generic range such as `weekend`. The adapter must not equate omitted planner fields with an unscoped user request.
6. The server validates model output with the typed input schema and rejects unknown fields, invalid ranges, oversized intervals, unsupported types, and ambiguous identities.
7. Tool results are not sent back to a model for factual rewriting. A deterministic renderer supplies the complete event section, coverage warning, empty state, or retryable error.
8. If generated prose is retained, it may only add a short introduction or next-step suggestion and must not introduce or modify dates, weekdays, times, teams, players, locations, RSVP states, counts, or completeness claims.
9. The tool call has explicit model-turn, elapsed-time, source-read, event, and output-size budgets. Budget exhaustion is represented as incomplete or truncated evidence, never authoritative absence.
10. The implementation records sanitized routing, schema-validation, tool-latency, source-coverage, retry, and result-class metrics without raw prompts or private schedule facts.
11. Schedule reads remain separate from write tools and confirmation groups. A read question cannot stage, confirm, or execute a schedule mutation.
12. Tool errors use stable domain codes so the client can distinguish clarification, unauthorized scope, temporary incomplete coverage, and internal failure without exposing private records.
13. The plain TypeScript domain core remains framework-neutral. The initial Firebase server adapter should use Genkit typed flows/tools and telemetry if adopted, but correctness and transport contracts cannot depend on Genkit prompt behavior.
14. Prompt and schema versions are independently observable, and rollback can route schedule reads to the prior path without changing unrelated Private AI tools.

## Design

### Routing boundary

Add a deterministic schedule-intent classifier for obvious phrases and allow the model to produce typed candidate intent for less direct questions. Preserve current-question candidates even when the planner emits no selectors, and attach launcher metadata from trusted application context rather than asking the model to reproduce it. Both paths enter the same temporal and identity resolver. This prevents a model from bypassing weekend normalization or launcher precedence.

### Server flow

Expose an authenticated callable or equivalent Firebase server endpoint that validates App Check where supported, derives the principal from server auth context, reauthorizes launcher resource IDs, resolves candidate intent and compatible launcher fallbacks, invokes the framework-neutral core with only normalized IDs and instants, and returns the versioned response. A Genkit flow can provide schema binding, model/provider abstraction, and trace integration while the core owns all domain rules.

### Answer assembly

Build the final chat message from deterministic title, day groups, event facts, coverage status, and follow-up actions. Preserve structured event data in the chat result so future UI cards do not need to parse prose.

## Tasks

- [ ] Define and register the typed `get_schedule_brief` adapter envelope, including current-question candidates and authenticated launcher context.
- [ ] Add deterministic obvious-schedule routing, typed candidate-intent validation, and separately sourced launcher-context propagation.
- [ ] Add the authenticated server flow with principal and App Check validation.
- [ ] Connect the flow to the framework-neutral schedule-brief core.
- [ ] Replace model factual rewriting with deterministic answer assembly.
- [ ] Add explicit model, tool, read, latency, and output budgets.
- [ ] Add prompt/schema version metrics and a schedule-only rollback flag.
- [ ] Add regressions for omitted planner filters with question and launcher scope preserved, incompatible launcher fallback removal, invalid tool arguments, extra model facts, budget exhaustion, and attempted read-to-write escalation.
