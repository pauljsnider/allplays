# Authorization, Queries, and Coverage

Status: Proposed

Depends on: [Temporal intent and schedule scope](./01-temporal-intent-scope.md), [authoritative schedule-brief contract](./02-schedule-brief-contract.md)

## Objective

Load the complete authorized schedule scope with database-bound filtering, bounded parallelism, explicit source coverage, and safe recovery from partial failures.

## Requirements

1. `getScheduleBrief` executes on an authenticated server boundary and authorizes the current Firebase UID against canonical team, player, family, staff, and manager relationships.
2. Mutable profile email fields may aid display or record discovery but never grant access. Existing canonical UID ownership takes precedence over legacy email aliases, and conflicting aliases fail closed.
3. Exact requested teams and players are authorized before event reads. An unscoped request discovers the complete authorized team set with pagination and completeness evidence.
4. An incomplete access-discovery result cannot establish that a requested team, player, or event is absent. Independently verified requested targets may still be queried and returned with truthful remaining coverage.
5. Native game and practice queries receive the resolved start and exclusive end bounds at the database boundary. Broad all-history loads followed by in-memory weekend filtering are not allowed.
6. Team detail, full roster, event detail, assignments, rideshare, and RSVP data are loaded only when the response contract requires them. Schedule listing must not hydrate every team or event by default.
7. Team and source reads fan out concurrently under deterministic concurrency, page, interval, deadline, and event limits. Limits are configuration values included in metrics and tests.
8. RSVP projections use bounded batch reads or precomputed authorized summaries rather than one read per returned event.
9. External and projected calendar reads are isolated by team and source. One failure retains successful native and external results from other sources and records the exact failed coverage entry.
10. The core retries only failed retryable coverage entries once within the request deadline. It does not repeat completed reads or rerun the language model.
11. A partial nonempty result may show confirmed events with a visible coverage warning, but it must not populate a cache as a complete result.
12. A first-load partial empty result triggers the bounded targeted retry. If it remains partial and empty, return a retryable error rather than an empty schedule.
13. When a prior complete result exists, a repeated partial-empty refresh preserves that complete state and reports that freshness could not be verified.
14. A later unforced load must be allowed to expand a previously shown partial-nonempty result; partial data cannot poison completeness caches.
15. A complete empty result is cacheable only for its exact principal, normalized scope, contract version, and bounded freshness period. Any access, team, player, source, or event mutation invalidates the relevant entry.
16. Source adapters distinguish not configured, authoritative not found, denied, timeout, parser failure, pagination overflow, and internal failure. Swallowed exceptions must still mark coverage incomplete.
17. All server logs and traces use opaque principal/request identifiers and safe team/source codes. They exclude raw prompts, emails, player names, event titles, provider URLs, calendar contents, and RSVP details.
18. The result remains read-only. No schedule mutation, RSVP write, or external provider side effect is authorized by this flow.

## Design

### Access graph

Build a server-maintained authorized schedule scope keyed by stable user and resource IDs. Revalidate the requested subset against canonical records at request time. Return internal access coverage separately from event-source coverage so a complete calendar read cannot hide incomplete team discovery.

### Query plan

Create a plan containing one bounded query group per authorized team and configured source. Execute groups through a concurrency limiter, aggregate settled results, and maintain their coverage entries. Push date and type filters into source adapters when supported; apply the same normalized filter again at the core boundary as defense in depth.

### Recovery and caching

Retry only retryable failures that fit within the overall deadline. Cache complete results and optionally partial nonempty payloads in separate states; never promote partial state to complete. Keep the last complete client state until a newer complete response replaces it.

## Tasks

- [ ] Define canonical server authorization and complete access-discovery adapters.
- [ ] Implement bounded native game, practice, projection, calendar, and RSVP query adapters.
- [ ] Pass exact temporal and type bounds to every capable data source.
- [ ] Add bounded concurrency, pagination, deadlines, cancellation, and read-budget accounting.
- [ ] Add per-source settled-result aggregation and targeted retry.
- [ ] Add complete and partial cache states with precise invalidation keys.
- [ ] Add authorization and privacy tests for cross-team, stale alias, ambiguous identity, and log redaction cases.
- [ ] Add first-load recovery, repeated partial-empty failure, legitimate complete emptiness, partial-nonempty expansion, calendar parser failure, and pagination-overflow regressions.
