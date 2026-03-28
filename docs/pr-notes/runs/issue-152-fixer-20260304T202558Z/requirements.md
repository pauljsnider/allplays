# Requirements Role (allplays-requirements-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-requirements-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent requirements analysis.

## Objective
Fix issue #152 where parents get a Firestore permission error when saving rideshare data.

## User-facing expectation
- Parents linked to a player on a team can create rideshare offers and requests from parent dashboard without permission denial.
- Existing owner/admin protections stay intact.

## Scope
- Firestore security rules for rideshare paths only.
- Add regression test coverage that reproduces this permission gap.

## Out of scope
- UI redesign or workflow changes in `parent-dashboard.html`.
- Data model changes beyond access checks.

## Success criteria
- Test reproducing parent access mismatch fails before the fix.
- After fix, tests pass and rideshare writes are allowed for legitimate linked parents.
- No widening to unaffiliated users.
