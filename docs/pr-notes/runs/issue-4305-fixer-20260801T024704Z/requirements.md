# Requirements

Starting SHA: `678e3b617dc75fe692122a6e28f320eb1d31d359`

## Current behavior

Player detail routes through `playerService.ts` and `legacyPlayerDb.ts` to the legacy `js/db.js` helper, which directly creates a `coparent_invite` access-code document. That bypasses the protected callable's exact-link authorization, idempotent reuse, and rate limits. The UI also treats every resolved request as a new invite and cannot distinguish created, reused, or throttled outcomes.

## Required outcome mapping

| Callable outcome | UI feedback |
|---|---|
| `created: true` | Report `Invite sent to <email>.` and show the code/link with queued-email state. |
| `reused: true` | Report `Existing invite reused for <email>. No new email was sent.` and keep the existing code/link shareable. |
| `functions/resource-exhausted` | Report throttling and `No email was sent.` without showing an invite result. |

## Assumptions and boundaries

- “Sent” means the new access-code creation initiated the existing asynchronous email trigger, not confirmed inbox delivery.
- Prefer the callable's normalized email in feedback.
- Keep Firestore rules, backend implementation, other invite workflows, redemption, and membership grants unchanged.

## Invariant

The Player co-parent creation workflow must cross `createCoParentInvite`; its UI must derive feedback from authoritative `created`, `reused`, or structured throttle outcomes.
