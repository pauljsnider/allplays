Implementation summary:
- Rename the schedule helper from `getSelectedOrDefaultConfigId()` to `getSelectedConfigId()`.
- Return the raw `<select>` value or `null` with no fallback resolution.
- Update add-game submit and calendar-track call sites to use the raw helper.
- Add focused unit coverage in `tests/unit/edit-schedule-stat-config-selection.test.js`.

Why this shape:
- Minimal patch in one file plus one regression test.
- Preserves the broader PR intent because config inference still exists in shared resolver helpers and default option selection.

Conflict resolution:
- Requirements and QA both favored preserving explicit `None`.
- Architecture noted a possible early-submit null edge case; accepted because it preserves visible user intent and reduces hidden mutation.
