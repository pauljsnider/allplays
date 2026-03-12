Coverage plan:
- Reproduce the bug with a fixed UTC timestamp under `TZ=America/Chicago`.
- Assert `formatIsoForInput()` returns the local wall-clock value expected by a `datetime-local` input.
- Execute `startEditPractice()` with stubbed DOM elements and verify the populated start and end inputs match the original local practice time.
- Add a source guard that editable schedule datetime-local fields use the shared helper instead of ad hoc UTC slicing.

Regression focus:
- Existing practice edits.
- Practice end time prefill.
- Shared schedule edit fields that also depend on local datetime formatting.

Validation:
- Run the focused unit test file first.
- Run the full unit suite if the focused coverage passes.
