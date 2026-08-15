# Temporal Intent and Schedule Scope

Status: Proposed

Depends on: Existing authenticated account, team, player, and Private AI launcher context

## Objective

Convert a natural-language schedule question into one explicit, authorized, timezone-aware scope before any schedule events are loaded or limited.

## Requirements

1. The resolver produces `startAt`, `endAtExclusive`, `timeZone`, team selectors, player selectors, event types, and a requested display limit before schedule aggregation begins.
2. Relative date phrases use the caller's IANA timezone supplied by the client or a verified account preference. They must never depend on a server process timezone.
3. "This weekend" and "the weekend" mean Friday 00:00 through Monday 00:00 in the caller's local calendar. Monday through Thursday resolve to the upcoming Friday; Friday through Sunday resolve to the containing weekend.
4. "Next weekend" means the Friday-through-Monday interval immediately after the interval that "this weekend" would select.
5. Explicit dates, date ranges, days of week, "today," "tomorrow," and relative week phrases normalize to an inclusive start instant and exclusive end instant. Invalid or missing timezone evidence produces a clarification or typed error rather than a guessed range.
6. Daylight-saving gaps and overlaps are resolved by a documented calendar library policy and covered by tests. Returned instants and rendered local values must round-trip without changing the requested local date.
7. A team, player, or event type explicitly named in the current question overrides launcher context. Launcher scope is used only when the current question omits that dimension.
8. An unscoped family or coach question includes every authorized schedule team. It must not default to the first child, team, managed team, or recently viewed event.
9. A named team resolves to one authorized canonical team before schedule loading. Zero matches fail closed; multiple normalized-name matches require clarification.
10. A named player resolves to one authorized canonical team and player before schedule loading. Team and player selectors that refer to different teams fail closed.
11. A natural first-name possessive may resolve only when exactly one stored full player name has that first name across active, inactive, unlinked, and otherwise unavailable account players. Ambiguity requires the full name; an unmatched full name must not use nearest-match selection.
12. Event-type terms normalize deterministically to supported categories such as game, practice, meeting, and other. A type filter is applied before limits and never substituted with another category.
13. The resolved scope records provenance for each dimension as explicit question, launcher fallback, account default, or system default so conflicts and telemetry are explainable.
14. The model may extract candidate phrases, but deterministic code validates and resolves every candidate. Model output alone is never authorization or date evidence.

## Design

### Temporal resolver

Implement a pure resolver that accepts the current instant, IANA timezone, normalized candidate intent, and product calendar rules. Use timezone-aware calendar arithmetic to find local boundaries, then convert those boundaries to instants. Keep the Friday-through-Sunday weekend rule in versioned product configuration so a future product change is deliberate and testable.

### Scope precedence

Represent every dimension as a value plus provenance. Resolve current-question selectors first, validate them against the authorized identity index, and use launcher selectors only for missing dimensions. Resolve identity before invoking the event repository so unauthorized or ambiguous names cannot widen the read.

### Unscoped aggregation

When no exact team or player is selected, pass the complete authorized team set to the schedule-brief core. Preserve linked player IDs per team for RSVP projection, but do not require player detail hydration merely to list events.

## Tasks

- [ ] Define the versioned temporal-intent and scope types.
- [ ] Implement pure relative-date and weekend normalization with IANA timezone support.
- [ ] Implement explicit-current-question versus launcher precedence.
- [ ] Implement exact team, exact player, and event-type normalization.
- [ ] Implement unique-first-name matching across selectable and unavailable players.
- [ ] Add ambiguity and privacy-safe error types.
- [ ] Add Friday, Saturday, Sunday, next-weekend, explicit-range, locale, and daylight-saving tests.
- [ ] Add regressions for unscoped multi-team scope, conflicting team/player scope, current-question override, and planner-omitted launcher filters.
