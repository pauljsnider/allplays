Thinking level: medium
Reason: the issue is broader than one patch, so the work needs a strict scope cut that still delivers user-visible value safely.

Implementation plan:
1. Add a regression test in `tests/unit/shared-schedule-sync.test.js` for mirrored tournament metadata.
2. Update `js/shared-schedule-sync.js` to clone and mirror the `tournament` object.
3. Run focused Vitest coverage for shared schedule and tournament helpers.
4. Commit the tested fix with an issue-linked message.
