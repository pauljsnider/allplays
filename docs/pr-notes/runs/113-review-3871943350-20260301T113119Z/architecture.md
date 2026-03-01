# Architecture Role Summary

- Thinking level: medium.
- Current state: parent-invite failures in two signup paths could leave a newly created Firebase Auth user while app-level linking failed.
- Proposed state: both paths become fail-closed with cleanup sequence `delete auth user` then `signOut`, each guarded independently so one cleanup failure does not skip the other.

## Risk Surface and Blast Radius

- Scope: auth/signup client flows (`js/signup-flow.js`, `js/auth.js`) and unit tests only.
- Blast radius: low; logic is in failure-only branches for parent-invite new user setup.
- Control equivalence: stronger than baseline because orphaned-account risk is reduced without loosening authorization controls.

## Tradeoff

- Added cleanup calls introduce extra async work on failure path, but that path is already exceptional and this is required for data hygiene.

## Conflict Resolution

- No role conflict detected. Requirements and QA both prioritize explicit cleanup assertions; architecture aligns on minimal localized patch.
