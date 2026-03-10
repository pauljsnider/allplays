Focus:
- Verify mirrored payload metadata points back to the source team.
- Confirm no broader shared-schedule helper expectations changed.

Validation scope:
1. Run `vitest` for `tests/unit/shared-schedule-sync.test.js`.
2. Review the helper diff to ensure only mirrored counterpart metadata changed.

Residual risk:
- Existing mirrored fixtures created before this patch still carry stale metadata until they are recreated or resynced by an edit.
