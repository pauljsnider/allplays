# Code Plan

## Implementation plan
1. Update `tests/smoke/admin-invite-redemption.spec.js` stubs to match the current `edit-team.html` import surface.
2. Add harmless no-op DB stub exports for roster rollover dependencies that are imported during page load.
3. Add the utility `escapeHtml()` export used by roster rollover rendering code.
4. Do not change production invite logic because the failure is in smoke-test scaffolding, not the admin invite implementation.

## Files changed
- `tests/smoke/admin-invite-redemption.spec.js`

## Tests
- Run affected unit coverage for admin invite behavior.
- Attempt targeted Playwright smoke locally; defer browser-backed validation to CI if local browser binaries are unavailable.
