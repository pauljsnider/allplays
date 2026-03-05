# Code Role Notes

Thinking level: low.

## Minimal implementation plan
1. Update reset helper unit test fixture/expectations to zero scores (and zero clock for canonical reset semantics).
2. In `startStop()` fresh-start clear branch, fetch and delete `liveEvents` docs with existing collection deletions.
3. Run targeted unit test.
4. Stage, commit with concise imperative message.
