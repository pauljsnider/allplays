Thinking level: medium
Reason: shared helper plus calendar fallback branch, but no schema or backend change.

Implementation plan:
1. Add a calendar-specific RSVP resolution helper that falls back only when the event has no child scope metadata.
2. Update `calendar.html` to use the new helper and preserve the legacy `playerIdsByTeam` payload.
3. Extend `tests/unit/calendar-rsvp-scope.test.js` with no-scope fallback coverage.
4. Rerun focused RSVP unit tests before commit.

Risks and rollback:
- Risk: incorrectly falling back on scoped events would reopen the multi-child submission bug.
- Mitigation: only fall back when the selected event scope resolves to zero child ids and no explicit child filters were provided.
- Rollback: revert the helper and call-site change.
