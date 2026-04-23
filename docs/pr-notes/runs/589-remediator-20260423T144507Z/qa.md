# QA Plan

## Risks
- Restored queued live events remain stranded after reload.
- Retry loop clears persisted queue too early and loses events during reload/crash.
- Retry backoff or queue draining regresses existing live broadcast behavior.

## Test Scenarios
1. Seed `localStorage` with two queued events, load tracker, verify retry scheduling starts automatically and queue drains after successful rebroadcast.
2. Force first retry item to fail, verify queue stays persisted with failed item still first and retry reschedules.
3. During a multi-item retry run, reload after the first item succeeds but before later items succeed, verify remaining items are still restored from storage.
4. Trigger a new broadcast failure while queue still has pending retry items, verify the new item remains queued after earlier items are removed.
5. Verify empty queue removes the `localStorage` entry.

## Evidence To Capture
- Browser console showing retry attempts and success/failure behavior.
- `localStorage` state before retry, after partial success, after failure, and after full drain.
- Manual note that no automated tests exist for this repo area.
