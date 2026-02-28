# QA Role Output (manual fallback)

## Failure reproduction target
Second/subsequent realtime snapshots in active chat session should still trigger last-read advancement.

## Test strategy
- Add a focused unit test for a pure helper that decides if last-read should update on a snapshot.
- Cover both initial and subsequent snapshot states.
- Cover guard case when no authenticated user is present.

## Regression checks
- Existing unit suite remains green.
- Manual sanity: open team chat, receive new message, navigate to dashboard, unread badge remains accurate.
