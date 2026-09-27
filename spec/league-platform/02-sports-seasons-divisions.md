# Sports, Seasons, and Divisions

Status: Proposed

Depends on: [League foundation](./01-league-foundation.md)

## Objective

Give each organization a versioned way to define the sports it offers, season boundaries, divisions, participation rules, and registration windows used by downstream registration and scheduling.

## Requirements

1. Administrators can configure multiple sports and concurrent or overlapping seasons in the organization timezone.
2. Each season supports registration windows, play dates, blackout dates, status, and an optional prior-season relationship.
3. Divisions support age or grade bands, gender or open-participation rules, roster limits, competition level, and sport-specific settings.
4. Rules must be effective-dated and versioned so published schedules, registrations, and historical results retain the rules used at creation time.
5. A participant or team may be evaluated against a division with an explainable eligible, ineligible, or needs-review result.
6. Administrators can grant a documented exception without altering the underlying rule; exceptions require reason, actor, time, and expiration.
7. Destructive changes are blocked while referenced by active registrations, teams, or published events; archival remains available.
8. Draft configuration is private to authorized staff until publication.
9. Publishing validates required fields, overlap conflicts, timezone transitions, and downstream compatibility.
10. Imports and copies from a prior season must be previewable and idempotent.

## Design

### Configuration model

Represent sport definitions as reusable organization records and seasons as immutable-ID containers. Divisions reference a published ruleset version rather than mutable fields. Store draft and published versions separately, with a publication record that identifies the actor and validation result.

### Eligibility service

Build one pure, deterministic evaluator used by registration, team formation, facility eligibility, and schedule generation. It accepts normalized participant or team facts plus a ruleset version and returns decision codes and human-readable reasons. Exceptions are separate signed records layered onto the evaluation.

### Experience and history

Provide setup steps for sport, season, division, review, and publish. Show the effect of each pending change before publication. Historical views render snapshot labels and rules without silently substituting current configuration.

## Tasks

- [ ] Define sport, season, division, ruleset, publication, and exception schemas.
- [ ] Implement deterministic rule validation and eligibility evaluation with reason codes.
- [ ] Build draft, preview, publish, archive, and prior-season copy server operations.
- [ ] Add administrator setup and comparison screens.
- [ ] Integrate published configuration into team, registration, and event selectors.
- [ ] Add timezone, boundary-date, overlap, exception, and referenced-record tests.
- [ ] Add audit, metrics, and publication failure recovery.
- [ ] Document compatibility behavior for existing unscoped teams and events.
