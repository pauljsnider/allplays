# Code Role Summary

## Minimal Patch
- `js/admin-invite.js`: add membership persistence verification gate before team admin-email write.
- `tests/unit/admin-invite.test.js`: add failure test ensuring no team write when membership missing.
- `js/auth.js` and `accept-invite.html`: bump `admin-invite.js` import version from `?v=1` to `?v=2`.

## Rollback
Revert this commit only; no data migration required.
