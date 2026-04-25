# Architecture

## Current State
- PR #590 updates `js/auth.js` to fail closed when Google signup cannot claim a standard activation code.
- Many HTML pages and JS modules import `auth.js` with pinned query-string versions.
- CI blocks the PR because the diff changes `js/auth.js` without any matching `auth.js?v=` import bump.

## Proposed State
- Normalize all direct `auth.js` imports in tracked app entry points, helper modules, and affected tests from older pins to `auth.js?v=12`.
- Update generated-workflow source and test fixtures to the same version so future generated pages stay aligned.

## Why This Scope
- Bumping only one consumer would satisfy the guard but would leave other cached entry points stale.
- Updating all direct consumers keeps cache semantics consistent with the static-site deployment model.
- Query-string only changes preserve runtime behavior and minimize blast radius.

## Blast Radius
- Touches static imports and test route stubs only.
- No Firebase, data model, or auth logic changes.
- Deploy impact is limited to forcing browsers to fetch the new auth module.

## Rollback
- Revert the version-pin commit.
- Previous import pins restore immediately on next deploy.

## Note
- Required role subagent spawn was attempted but unavailable due local gateway session closure, so this artifact is a main-run synthesis for traceability.
