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
7. A repeated partial empty result shows a retryable error and preserves the last complete brief. It must not render an empty-state illustration or phrase that implies absence.
8. Loading, retry, offline, stale, partial, empty, and fatal states are accessible, keyboard operable, and announced correctly to assistive technology.
9. The ChatGPT MCP `list_schedule` surface becomes a compatibility alias or thin adapter to the shared `getScheduleBrief` core. It does not retain separate authorization, calendar, RSVP, deduplication, or absence logic.
10. MCP accepts explicit `startAt`, `endAtExclusive`, and `timeZone` fields and returns the full response as `structuredContent` plus deterministic text generated from the same formatter.
11. App and MCP adapters pass identical contract fixtures and produce equivalent event ordering, coverage, truncation, and absence evidence.
12. Deep links use authorized app routes and stable occurrence IDs. Imported events without unsupported detail capabilities do not advertise those actions.
13. Existing direct "next game" and "last game" shortcuts either call the shared core with explicit bounds and types or prove equivalent coverage and deterministic rendering through shared helpers.
14. The enhancement does not change schedule creation, editing, RSVP writes, rideshare, assignments, or notification confirmation behavior.

## Design

### Shared presentation model

Add one adapter that converts the versioned domain response into day groups, event cards, warning rows, empty state, and retry actions. The chat bubble may initially render deterministic text while retaining the structured model for a later card UI.

### State recovery

Key the last complete brief by principal, normalized scope, and contract version. A partial refresh may overlay a warning and confirmed new facts but cannot erase complete cached facts as though the schedule were empty. A later complete response replaces the stale state atomically.

### MCP transport

Keep MCP authentication and transport concerns in the service, then call the shared server/domain boundary. Map domain errors to MCP error codes and return both structured and textual content without maintaining a second event aggregator.

## Tasks

- [ ] Build the shared app response adapter and deterministic formatter.
- [ ] Add range, day, team, event, coverage-warning, empty, stale, and retry UI states.
- [ ] Preserve the last complete brief across partial-empty refreshes and interrupted navigation.
- [ ] Add accessible announcements and keyboard behavior for changed states.
- [ ] Replace MCP schedule aggregation with the shared domain adapter and structured contract.
- [ ] Route next-game and last-game shortcuts through shared range and presentation helpers.
- [ ] Add app/MCP golden-fixture parity tests.
- [ ] Add a multi-team weekend smoke test covering at least two teams and two source kinds.
