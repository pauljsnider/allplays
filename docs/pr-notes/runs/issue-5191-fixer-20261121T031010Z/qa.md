# QA strategy

## Regression boundary

Test two contracts separately: pure playlist eligibility/ordering and viewer-local start, advancement, progress, stop, and completion teardown.

## Coverage

- `tests/unit/live-game-video.test.js`: ordering; invalid range exclusion; duration and 60-second clamping; standalone and different-source exclusion; same-source/URL-less inclusion; no mutation.
- `tests/unit/live-game-replay-init.test.js`: eligibility; explicit-tap playback; advancement; progress; completion; Stop preventing later advancement; external clips excluded.
- `tests/smoke/game-post-game-stat-editor.spec.js`: one 390x844 completed replay scenario that taps Watch, drives both boundaries, verifies progress/completion, and checks overflow.

## Focused validation

```bash
npx vitest run tests/unit/live-game-video.test.js tests/unit/live-game-replay-init.test.js tests/unit/player-profile-cache-delivery.test.js tests/unit/rsvp-precedence-cache-bust.test.js --reporter=verbose
npx playwright test tests/smoke/game-post-game-stat-editor.spec.js --config=playwright.smoke.config.js --project=smoke --grep "highlight reel" --reporter=line
```

## Prevention

Sequential media features must separate deterministic eligibility/order from disposable UI state, and regress teardown so stop/completion cannot leave ordinary playback bounded by stale reel state.
