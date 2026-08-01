# Architecture

Starting SHA: `678e3b617dc75fe692122a6e28f320eb1d31d359`

## Current and proposed flow

- Current: `PlayerDetail` → `playerService` → `legacyPlayerDb` → `js/db.js::inviteCoParentToAthlete` → browser-created `accessCodes` document.
- Proposed: `PlayerDetail` → `playerService` → `legacyPlayerDb` → `httpsCallable(functions, 'createCoParentInvite')`.

The callable accepts `{ teamId, playerId, email }`. It derives the caller from Firebase Auth and team/player context from Firestore. It returns created or reused flags; rate limiting rejects with `functions/resource-exhausted`. Only a newly created document activates the existing email on-create trigger.

## Scope decision

Call the callable directly from the app adapter and remove its import of the legacy direct-write helper. Do not change `js/db.js`: that helper is also used by `parent-dashboard.html`, which is another invitation workflow and out of scope. App bundles are content-hashed, so this route requires no legacy cache-bust cascade.

## Safety

- Authorization remains fail-closed at the callable's exact `parentPlayerKeys` check.
- Reuse is server-authoritative and does not queue another email.
- Throttling commits neither an invite nor partial quota reservations.
- Redemption and membership grants remain unchanged.
- Feedback must not claim confirmed email delivery.
