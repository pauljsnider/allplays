## Objective
- Add tournament-grade native standings rules that match common event/tournament expectations.

## Current State
- Native standings support only one ordered tiebreaker list and a small rule set.
- Score differential is accumulated from raw scores, so blowouts can distort standings.
- Admins cannot configure points values, capped differential, or separate two-team and multi-team tie behavior.

## Proposed State
- Support configurable point values, capped goal differential, and separate ordered tiebreaker stacks for two-team and multi-team ties.
- Preserve existing native-standings behavior for teams that only use the legacy config fields.
- Keep standings deterministic with a final alphabetical fallback.

## Risk Surface
- Blast radius is limited to native standings calculation and the team edit form persistence path.
- No Firestore rules, auth, or tenant-access logic changes.
- Main regression risk is reordering existing standings when teams rely on legacy tiebreaker config.

## Assumptions
- Tournament admins expect capped differential to affect only differential-based rules, not raw goals for/against.
- Separate multi-team handling is needed only when more than two teams remain tied on the primary ranking metric.
- Requested role skills are not exposed in this session, so this file captures the requirements-role synthesis directly.

## Recommendation
- Add the new controls and schema now, while keeping legacy `tiebreakers` as a backward-compatible fallback.
- Implement group tie resolution with mini-table head-to-head logic before falling through to secondary rules.

## Success Criteria
- Admins can save standings point values, capped differential, and separate two-team and multi-team tiebreaker lists.
- Multi-team ties resolve consistently using group head-to-head and downstream tournament rules.
- Blowout margins above the configured cap no longer over-influence standings.
