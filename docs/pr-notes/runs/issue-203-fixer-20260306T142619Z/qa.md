Focus:
- Regression-proof local-time prefill for schedule editing in a non-UTC timezone.

Primary test:
- Read `edit-schedule.html` and assert the scheduling `datetime-local` inputs use `formatIsoForInput(...)` instead of direct UTC slicing.

Manual spot check to recommend in PR:
1. In `America/Chicago`, create a practice at 2026-03-10 20:00.
2. Reopen edit form and confirm the input still shows `2026-03-10T20:00`.
3. Save without changing time and confirm the practice remains on 2026-03-10 20:00 local.

Residual risk:
- Other pages outside `edit-schedule.html` could still have independent timezone-prefill bugs.
