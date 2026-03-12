Validation target: manual verification only per repo guidance.
Manual cases:
1. Cancel succeeds and chat notification succeeds: schedule refreshes, no alert.
2. Cancel succeeds and chat notification fails: alert still appears.
3. Cancel succeeds, chat notification fails, and `loadSchedule()` rejects: partial-success alert still appears; refresh failure is logged and/or surfaced separately.
Residual risk: no automated harness here, so validation is limited to static inspection unless a manual browser run is performed.
