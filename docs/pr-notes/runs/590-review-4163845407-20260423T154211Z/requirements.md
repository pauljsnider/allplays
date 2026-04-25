# Requirements

## Objective
Unblock PR #590 by ensuring the `js/auth.js` cache-bust version changes anywhere the browser can import it after the Google signup fail-closed fix.

## Acceptance Criteria
- `js/auth.js` changes are paired with an `auth.js?v=` version bump in repo consumers.
- The update covers HTML entry points and JS modules that import `auth.js` directly.
- Related tests and smoke stubs referencing the auth module version are updated to the same version.
- `tests/unit/auth-signup-parent-invite.test.js` still passes for the Google signup cleanup failure path.
- The cache-bust guard passes when evaluated against the committed PR diff.

## Non-goals
- No behavior change to signup logic beyond the already-landed PR #590 fix.
- No version bump for unrelated modules.
- No refactor of cache-bust strategy in this PR.

## User and Risk Impact
- Prevents clients from serving stale `auth.js` after deploy.
- Keeps the fail-closed Google signup fix reachable for real users.
- Risk is low and limited to import query strings plus matching test fixtures.

## Done Means
- PR branch contains only cache-bust follow-up updates.
- Unit checks for auth and affected fixtures pass.
- Cache-bust guard failure is cleared on the updated branch.

## Note
- Required role subagent spawn was attempted but unavailable due local gateway session closure, so this artifact is a main-run synthesis for traceability.
