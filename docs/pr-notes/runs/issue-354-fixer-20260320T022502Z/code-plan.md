Thinking level: medium
Reason: narrow implementation scope, but the issue references stale test infrastructure and needs a testable seam with minimal product risk.

Plan:
1. Add a pure helper module for calendar import URL validation and duplicate-safe merge behavior.
2. Update `edit-schedule.html` to consume the helper in the add-calendar save handler and `loadSchedule()`.
3. Add focused Vitest coverage for helper behavior and page wiring.
4. Run targeted unit tests.
5. Commit the helper, page wiring, tests, and role notes together with an issue-referencing message.
