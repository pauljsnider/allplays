# QA Role (fallback local synthesis)

## Risk focus
- Regression: finish modal submit/email preview must still work.
- Guard correctness: AI button should be hidden and not wired when unavailable.
- Positive path: explicit enable flag should keep existing AI flow accessible.

## Test strategy
- Add unit test asserting `track.html` imports and uses availability gate.
- Assert guarded listener attachment pattern exists and unguarded attachment is absent.
- Manual spot check (if needed): finish modal open/save unaffected.
