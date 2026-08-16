# Application and MCP Experience

Status: Proposed

Depends on: [Authoritative schedule-brief contract](./02-schedule-brief-contract.md), [AI orchestration and tool execution](./04-ai-orchestration-tools.md)

## Objective

Give users the same complete, readable, timezone-correct schedule brief in React web, iOS, Android, and ChatGPT MCP without duplicating schedule business logic.

## Requirements

1. React web and packaged iOS and Android builds call the same authenticated server flow and use one shared response adapter in `apps/app/src/`.
2. The app renders a clear range heading followed by events grouped by local day and ordered deterministically across teams.
3. Every event identifies its team and type. Player context, RSVP, location, opponent or title, status, and deep link appear only when present and authorized.
4. The displayed weekday, date, and time are computed from the event instant and response timezone by the shared deterministic formatter. They cannot be supplied by generated prose.
5. A complete empty result explicitly says no matching events were found for the resolved range and scope.
6. A partial nonempty result shows confirmed events and a persistent warning that named teams or sources could not be verified. The warning identifies affected authorized team display names or source categories without leaking hidden resources.
7. A repeated partial empty result shows a retryable error. Cache reconciliation occurs per coverage-ledger entry: an authoritatively completed source replaces its prior cached facts, including replacing them with an empty slice when events were canceled or removed; only facts belonging to failed or otherwise unverified sources are retained and explicitly labeled stale. It must not render an empty-state illustration or phrase that implies absence.
8. Loading, retry, offline, stale, partial, empty, and fatal states are accessible, keyboard operable, and announced correctly to assistive technology.
9. The ChatGPT MCP `list_schedule` surface becomes a compatibility alias or thin adapter to the shared `getScheduleBrief` core. It does not retain separate authorization, calendar, RSVP, deduplication, or absence logic.
10. MCP accepts explicit `startAt`, `endAtExclusive`, and `timeZone` fields and returns the full response as `structuredContent` plus deterministic text generated from the same formatter. During compatibility migration, `list_schedule` also continues to accept its optional legacy `startDate` and `endDate` ISO calendar-date fields, with their existing defaults and inclusive semantics. The adapter rejects mixed legacy and instant forms. A supplied bare legacy start remains `00:00:00.000Z` on that UTC calendar date, and a supplied inclusive legacy end remains through `23:59:59.999Z`, represented to the shared core as `00:00:00.000Z` on the following UTC calendar date exclusive. This mapping is independent of caller timezone; caller-local legacy boundaries require a separately versioned behavioral change. Missing legacy fields retain the current legacy default calculations, and removal of the legacy schema requires a separately announced deprecation.
11. App and MCP adapters pass identical contract fixtures and produce equivalent event ordering, coverage, truncation, and absence evidence.
12. Deep links use authorized app routes and stable occurrence IDs. Imported events without unsupported detail capabilities do not advertise those actions.
13. Existing direct "next game" and "last game" shortcuts either call the shared core with explicit bounds and types or prove equivalent coverage and deterministic rendering through shared helpers.
14. The enhancement does not change schedule creation, editing, RSVP writes, rideshare, assignments, or notification confirmation behavior.

## Design

### Shared presentation model

Add one adapter that converts the versioned domain response into day groups, event cards, warning rows, empty state, and retry actions. The chat bubble may initially render deterministic text while retaining the structured model for a later card UI.

### State recovery

Key cached slices by principal, normalized scope, contract version, and coverage-ledger entry (team and source). Reconcile a partial refresh entry by entry: replace facts for each source that completed authoritatively, including a complete-empty slice; merge confirmed facts without deleting beyond verified coverage for a truncated source; and retain prior facts only for failed or unverified sources while marking those retained slices stale. This prevents a completed source's cancellation or removal from being hidden by an unrelated source failure. A later complete response replaces every slice atomically.

### MCP transport

Keep MCP authentication and transport concerns in the service, then call the shared server/domain boundary. Preserve `list_schedule` as a versioned legacy-input adapter, normalize its inclusive bounds and defaults into the new core contract, and emit deprecation telemetry before removing it. Map domain errors to MCP error codes and return both structured and textual content without maintaining a second event aggregator.

## Tasks

- [ ] Build the shared app response adapter and deterministic formatter.
- [ ] Add range, day, team, event, coverage-warning, empty, stale, and retry UI states.
- [ ] Reconcile cached facts per coverage entry across partial-empty refreshes and interrupted navigation, replacing completed slices and retaining only failed or unverified slices as stale; add distinct regressions proving failed-slice and unverified-slice prior facts are retained with stale provenance.
- [ ] Add accessible announcements and keyboard behavior for changed states.
- [ ] Replace MCP schedule aggregation with the shared domain adapter while preserving and testing legacy inclusive `list_schedule` inputs, UTC boundaries, and defaults.
- [ ] Route next-game and last-game shortcuts through shared range and presentation helpers.
- [ ] Add app/MCP golden-fixture parity tests.
- [ ] Add a multi-team weekend smoke test covering at least two teams and two source kinds.
