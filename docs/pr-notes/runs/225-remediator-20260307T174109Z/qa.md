Validation focus:
- Existing tracked game with persisted `liveClockPeriod/liveClockMs`.
- Choose Cancel in the resume prompt.
- Verify the game doc is reset to `Q1`, `0`, and `running=false`.
- Reload tracker and confirm it starts from `Q1` / `00:00` with no stale clock restoration.

Regression checks:
- Resume path when choosing OK should still restore the live clock from events or persisted fields.
- Reset broadcast event remains unchanged and still communicates cleared live state to viewers.

Evidence available in code:
- `deriveResumeClockState()` uses persisted clock only when event data is absent or unusable.
- `updateGame()` is a patch update, so reset must explicitly overwrite live clock fields.
