Implementation plan:
1. Update the cancel-game handler metadata write to use `sent: !result.notificationError`.
2. Tighten `tests/unit/edit-schedule-cancel-game-notification.test.js` around metadata inputs.
3. Add a new unit test file for `renderDbGame` cancelled-row output.
4. Run the focused Vitest commands covering the changed area.

Blocked orchestration note:
- The requested orchestration skills/subagent tooling were not available in this lane, so these notes capture the required role synthesis directly.
