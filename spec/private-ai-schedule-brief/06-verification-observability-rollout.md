# Verification, Observability, and Rollout

Status: Proposed

Depends on: Specifications [1](./01-temporal-intent-scope.md), [2](./02-schedule-brief-contract.md), [3](./03-authorization-queries-coverage.md), [4](./04-ai-orchestration-tools.md), and [5](./05-application-mcp-experience.md)

## Objective

Prove the enhancement across existing schedule layers, enforce performance and privacy budgets, and release it gradually with exact rollback evidence.

## Requirements

1. Existing Private AI, schedule service, MCP core, source-contract, and smoke suites are extended rather than replaced. A new focused domain-core suite owns temporal, coverage, and contract invariants.
2. Regression coverage includes a Friday "What's the weekend look like?" request with matching events across multiple authorized teams.
3. Tests prove that earlier unrelated events and global limits cannot hide a requested team, player, type, or weekend event.
4. Tests cover current-question override, launcher fallback when planner args are omitted, exact team resolution, production-shaped full player names, first-name ambiguity including unavailable players, mismatched full names, and conflicting team/player scope.
5. Temporal tests cover every day of week, this versus next weekend, explicit date ranges, exclusive end boundaries, caller/server timezone disagreement, daylight-saving gaps and overlaps, and deterministic weekday rendering.
6. Coverage tests include complete nonempty, legitimate complete empty, truncated nonempty, first-load partial-empty recovery, repeated partial-empty failure, partial-nonempty display, later unforced expansion, access-discovery partiality, direct external-calendar failure, parser failure, pagination overflow, and targeted retry.
7. Contract tests reject any response that confirms absence while partial, failed, or truncated and reject any rendered fact that differs from the normalized event.
8. Authorization tests cover unauthorized teams and players, stale or conflicting legacy aliases, cross-principal cache isolation, deep-link scoping, and sanitized errors and logs.
9. Query tests assert date and type bounds reach native source calls before rows are returned, detail hydration stays disabled for listing, completed sources are not retried, and RSVP loading has no per-event N+1 behavior.
10. App/MCP parity tests run the same fixtures through both transports and compare normalized events, ordering, coverage, truncation, absence, and deterministic text facts.
11. The initial performance budget records source reads, documents read, fanout width, retries, tool latency, total latency, and output size by authorized team count. CI includes a deterministic upper-bound regression rather than a wall-clock-only assertion.
12. Initial rollout targets should be measured against production-like fixtures before activation: one model routing turn, one domain tool call, no repeated completed reads, and bounded growth as team count increases.
13. Metrics classify complete, complete-empty, partial-nonempty, partial-empty, ambiguous, unauthorized, truncated, and failed results. Logs contain no raw prompts, email addresses, player names, event titles, locations, RSVP details, or calendar contents.
14. A shadow mode compares old and new normalized results for authorized internal accounts without displaying or persisting private event payloads. Comparison telemetry stores only counts, opaque IDs, coverage categories, and mismatch codes.
15. Rollout is guarded independently for the app schedule route and MCP adapter. Rollback restores the previous read path without changing write tools or deleting new contract data.
16. Old app and MCP aggregators are removed only after the new exact head passes focused suites, integration smoke, privacy review, rollout metrics, and a documented observation window.

## Verification matrix

| Layer | Primary files | Required evidence |
|---|---|---|
| Temporal and domain core | New colocated core tests | Range, scope, contract, sorting, deduplication, coverage, and rendering invariants |
| Private AI routing | `tests/unit/app-private-ai-service.test.js` | Planner omissions, launcher precedence, multi-team weekend, ambiguity, limits, and no factual rewriting |
| Schedule adapters | `apps/app/src/lib/scheduleService.test.ts` and source-contract tests | Database bounds, source isolation, targeted retry, partial/cache matrix, and read budgets |
| MCP transport | `tests/unit/chatgpt-mcp-core.test.js` | Shared-core use, structured response, errors, privacy, and app parity |
| User flow | `tests/smoke/app-private-ai.spec.js` | Signed-in multi-team weekend answer, correct weekday, partial warning, retry, and no false absence |
| Server boundary | New callable/flow tests | Auth, App Check policy, schema limits, authorization, timeout, and sanitized telemetry |

## Design

### Staged delivery

Deliver the deterministic core and source adapters first, then the server flow and app integration, then MCP consolidation and old-path removal. Every pull request has an independently testable outcome and is bound to an exact base and head SHA.

### Observability

Emit counters and duration histograms by contract version, result class, team-count bucket, source kind, and retry state. Use opaque request correlation IDs and safe error codes. A dashboard should expose false-empty prevention, partial rates, source failures, latency, read budgets, and app/MCP parity mismatches.

### Rollback

Keep the new core side-effect free and versioned. During rollout, a server-controlled flag chooses the read adapter while clients accept both response versions. Rollback disables the new read path and preserves the last complete client state; it never broadens authorization or converts an incomplete response into emptiness.

## Tasks

- [ ] Add the new domain-core, server-flow, and app/MCP parity test suites.
- [ ] Extend the existing Private AI, schedule service, MCP, source-contract, and smoke suites with the verification matrix.
- [ ] Add deterministic document-read, fanout, retry, and output budget assertions.
- [ ] Add result-class, coverage, latency, privacy, and parity telemetry.
- [ ] Add privacy-safe shadow comparison for authorized internal accounts.
- [ ] Add independent app and MCP rollout flags plus rollback tests.
- [ ] Document production-like fixture validation, observation thresholds, and operator response.
- [ ] Remove duplicate aggregators only after exact-head validation and rollout acceptance evidence.
