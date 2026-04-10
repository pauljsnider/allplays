Validation plan:
- Run the targeted unit tests covering admin invite acceptance and the new atomic expiration guard.
- If the focused suite passes, no broader test run is necessary because the change is isolated to one data-layer function and one regression test.

Risk focus:
- Ensure expired admin invite codes now throw before granting access.
- Ensure existing caller-shape coverage still passes so the signature regression does not reappear.
