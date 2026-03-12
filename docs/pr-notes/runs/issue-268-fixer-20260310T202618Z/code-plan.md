# Code Plan

Thinking level: medium. The bug is narrow, but the page has to stay aligned with shared access behavior.

Plan:
1. Add a unit test for the stats config page access decision, including platform-admin and parent-only paths.
2. Introduce a tiny helper module for `edit-config.html` that uses `getTeamAccessInfo(...)` and preserves redirect targets.
3. Replace the page's inline boolean gate with the shared decision helper.
4. Run the focused Vitest suite and commit the fix with issue reference.
