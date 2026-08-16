# Authoritative Schedule-Brief Contract

Status: Proposed

Depends on: [Temporal intent and schedule scope](./01-temporal-intent-scope.md)

## Objective

Define one transport-neutral request and evidence-bearing response that can answer schedule questions without asking a language model to infer facts or completeness.

## Requirements

1. The core operation is versioned and named `getScheduleBrief`; AI-facing adapters expose it as `get_schedule_brief`.
2. The domain-core request includes `startAt`, `endAtExclusive`, `timeZone`, resolved team IDs, optional player IDs, optional event types, `includeRsvp`, and `maxEvents`.
3. The AI-facing adapter tool uses a separate versioned envelope that carries typed candidate intent from the current question and authenticated launcher context to the trusted server resolver. The resolver validates and reauthorizes that evidence, applies selector precedence, and constructs the normalized domain-core request; raw prompts and chat transcripts do not enter the core.
4. `startAt` is inclusive and `endAtExclusive` is exclusive. Both are RFC 3339 instants and must satisfy `startAt < endAtExclusive` within a configured maximum interval.
5. IDs in the request are resolution outputs, not client authorization claims. The server reauthorizes them against the current principal.
6. Each event contains a stable occurrence ID, canonical team ID and display name, linked player IDs when permitted, event type, start and optional end instant, source timezone, title or opponent, location, status, source kind, source label, RSVP projection when requested, and an authorized deep link.
7. Recurring and imported events use stable occurrence identities. Native, projected, and external-calendar aliases for the same occurrence are deduplicated with deterministic precedence.
8. Events are filtered by resolved team, player, type, and date scope before `maxEvents` is applied, then sorted by start instant, team display name, type, and stable occurrence ID.
9. The response includes `requestedTeamIds`, `completedTeamIds`, a per-team/per-source coverage ledger, `complete`, `truncated`, `absenceConfirmed`, `asOf`, and typed warnings or failures.
10. `complete` is true only when authorization discovery, every requested source, pagination, filtering, and required projection read completed authoritatively.
11. `absenceConfirmed` is true only when the result is complete, not truncated, and contains zero matching events after all filters. It is false for every partial, failed, or limited-empty result.
12. `truncated` is true when additional matching events exist beyond `maxEvents` or a safety bound prevents exhaustive enumeration. A truncated response can never confirm absence.
13. Failure entries identify the authorized team, source kind, retryability, and sanitized error code without including raw provider URLs, tokens, event titles, player names, emails, or stack traces.
14. The response distinguishes no authorized scope, valid complete emptiness, partial emptiness, partial nonempty results, invalid intent, ambiguous identity, and temporary unavailability.
15. Date labels, weekdays, times, team names, locations, and RSVP facts are rendered from the normalized response by deterministic formatters. A language model may not restate those fields from memory.
16. The contract is serializable as plain JSON, has schema validation at every transport boundary, and supports additive versioning without breaking packaged mobile clients or MCP consumers.

## Design

### Request shape

Keep temporal and identity resolution outside the event repository, then pass only validated normalized selectors into the core. The adapter tool envelope preserves typed current-question candidates and authenticated launcher team/player context even when the planner omits selectors; the trusted server resolver consumes that envelope before invoking the core. The resulting core request carries its contract version and scope provenance for diagnostics, but the domain core does not depend on candidate phrases, launcher payloads, raw prompts, or chat transcripts.

### Coverage ledger

Record one entry for every expected source of every requested team, including native games, native practices, shared or projected events, external calendars, and optional RSVP data. Each entry is `complete`, `failed`, `skipped-not-configured`, or `truncated`, with a typed reason and attempt count. Derive top-level evidence from the ledger rather than setting booleans independently.

### Deterministic presentation

Produce render-ready day groups and event facts alongside normalized events. Clients may choose cards or text, but both consume the same local-date formatter and immutable fact strings. Generated prose is limited to a non-factual introduction or follow-up suggestion.

## Tasks

- [ ] Define the adapter intent/launcher envelope plus domain-core request, event, coverage, warning, failure, and response schemas.
- [ ] Add runtime schema validation and a contract version.
- [ ] Implement stable occurrence identity and cross-source deduplication.
- [ ] Implement filter-before-limit ordering and deterministic sorting.
- [ ] Derive `complete`, `truncated`, and `absenceConfirmed` from coverage evidence.
- [ ] Implement timezone-aware deterministic day groups and fact strings.
- [ ] Add schema fixtures for complete, complete-empty, truncated, partial-nonempty, partial-empty, and failed responses.
- [ ] Add contract tests that reject inconsistent evidence such as `absenceConfirmed: true` with a failed source.
- [ ] Add adapter tests proving omitted planner selectors still preserve current-question candidates and launcher fallback through trusted server resolution.
