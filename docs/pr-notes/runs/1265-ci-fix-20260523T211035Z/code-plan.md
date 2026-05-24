# Code plan

## Implementation plan
- Edit `tests/smoke/edit-config-platform-admin.spec.js` only.
- Replace the stubbed banner's `id="team-name-display"` with a test-specific `data-testid="team-admin-banner-name"`.
- Do not change production HTML or JS because the production banner does not create the duplicate ID.

## Validation
- Run targeted smoke validation for `tests/smoke/edit-config-platform-admin.spec.js`.
