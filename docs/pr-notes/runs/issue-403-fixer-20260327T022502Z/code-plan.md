Implementation plan:
1. Add a focused unit harness for `calendar.html` that boots the module with mocked dependencies and DOM nodes.
2. Reproduce the bug by opening a day modal, submitting RSVP in calendar view, and asserting the modal HTML updates in place.
3. Fix `calendar.html` by storing the active day-modal selection and rerendering it after successful RSVP submission while the modal is visible.
4. Run the relevant Vitest suite, then stage and commit the test plus fix together.

Constraints:
- Keep the patch local to `calendar.html` and the new unit regression.
- No unrelated cleanup or refactoring.
