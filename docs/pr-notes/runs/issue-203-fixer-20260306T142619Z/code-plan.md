Thinking level: medium
Reason: narrow bug, but it requires confirming which schedule-edit paths still bypass the local-input helper.

Implementation plan:
1. Strengthen the existing timezone regression test so it catches any raw UTC `datetime-local` prefill left in `edit-schedule.html`.
2. Replace the remaining direct `toISOString().slice(0, 16)` schedule-edit prefill with `formatIsoForInput(...)`.
3. Run the targeted unit test under `TZ=America/Chicago`.

What would change my mind:
- Evidence that the remaining raw UTC prefill is intentionally storing UTC wall-clock values, which would make helper reuse incorrect.
