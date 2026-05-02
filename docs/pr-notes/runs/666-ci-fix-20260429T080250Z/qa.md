# QA Notes: PR #666 CI Fix

## Acceptance Criteria
- `tests/unit/live-game-replay-init.test.js` compiles without `SyntaxError: Missing initializer in destructuring declaration`.
- Replay init tests continue to verify chat lockout behavior for replay pages with and without saved replay events.
- Full unit CI passes.

## Targeted Validation
```bash
npx vitest run tests/unit/live-game-replay-init.test.js --reporter=dot
npx vitest run tests/unit/live-game-replay-viewer.test.js tests/unit/live-game-chat.test.js --reporter=dot
npm run test:unit:ci
```

## Regression Watch
- Replay pages should not enable chat for replay viewers.
- Live game pages should keep existing chat behavior.
- Test harness should tolerate cache-busted import version changes for `live-game-video.js`.
