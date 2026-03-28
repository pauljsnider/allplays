Test strategy:
- Extend the cancel handler unit test to assert partial chat failure still reloads schedule, warns non-blockingly, and marks notification metadata unsent.
- Add render coverage for a cancelled game row to assert:
  - `CANCELLED` badge is shown
  - `Command Center` link is absent
  - `Cancel` button is absent

Regression guardrails:
- Keep fatal cancellation-write failure behavior unchanged.
- Run the focused edit-schedule unit tests plus schedule notification helpers after patching.
