# QA strategy

Starting SHA: `678e3b617dc75fe692122a6e28f320eb1d31d359`

## Regression coverage

1. Add an adapter test proving Player detail invokes `createCoParentInvite` with only normalized `{ teamId, playerId, email }`, returns the callable payload, and no longer imports the legacy direct-write helper.
2. Add three `PlayerDetail` workflow tests:
   - created shows sent/queued feedback and a shareable code;
   - reused shows the existing code and explicitly says no new email was sent;
   - `functions/resource-exhausted` shows throttling, no stale result card, and no email claim.

Existing backend tests already cover exact authorization, atomic creation, active-invite reuse, and durable sender/recipient rate limiting.

## Focused commands

```bash
npm run test:app -- src/lib/adapters/legacyPlayerDb.test.ts src/pages/PlayerDetail.test.tsx
npm run app:build
node scripts/check-critical-cache-bust.mjs
```

Recurrence risk: **medium** because the app/legacy adapter boundary can silently preserve browser-side authorization writes unless the callable routing and result semantics are tested together.
