Test strategy:
- Add a unit test for the cancel flow helper that proves:
  1. cancellation success + chat failure still resolves as successful cancellation with a warning
  2. cancellation failure still returns a fatal error and does not attempt chat
- Add a lightweight wiring assertion in `edit-schedule.html` only if needed to confirm the page uses the helper.

Regression risks to watch:
- Users should not see a fatal cancel error when the game document was already updated.
- Chat warning text should be explicit enough to explain the partial failure without implying rollback.
- Schedule reload should still happen after a successful cancellation, including when chat notification fails.

Validation:
- Run the new focused unit test file.
- Run the existing edit-schedule unit test file to catch accidental page-script regressions.
