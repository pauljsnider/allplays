Plan:
1. Add a focused unit harness that boots `js/live-game.js` with replay URL params and mocked replay data.
2. Reproduce the bug by asserting the empty-events replay branch leaves chat disabled and shows the replay lock notice.
3. Patch replay startup once so both replay branches share the same chat lockout behavior.
4. Run targeted Vitest coverage for the new replay init test and existing chat helper coverage.
