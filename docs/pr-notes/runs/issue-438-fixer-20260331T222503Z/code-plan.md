Thinking level: medium
Reason: the workflow crosses editor hydration, submit serialization, and season-record calculation, but the smallest reliable fix is still local.

Implementation plan:
1. Add a regression test file for schedule-game season-record metadata create/edit/reload behavior.
2. Run the targeted test to confirm failure because the shared helper seam does not exist yet.
3. Add a new helper module for season-record metadata defaults and form payload shaping.
4. Wire `edit-schedule.html` to the helper at load, edit, and submit points.
5. Run targeted unit tests and commit the minimal patch.
