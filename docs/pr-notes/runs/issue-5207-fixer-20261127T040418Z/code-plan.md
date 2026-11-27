# Code plan

1. Replace the dashboard click handler's direct `redeemParentInvite` call with a navigation to `/app/#/accept-invite?code=${encodeURIComponent(code)}`.
2. Remove the now-unused `redeemParentInvite` import from the dashboard's `db.js` import list.
3. Keep empty-input feedback unchanged.
4. Update the nearest wiring regression to assert canonical routing and reject a return to a type-specific call.
5. Run only the two focused invite-flow unit files, then inspect the diff and commit both production and test changes with issue #5207 in the message.

No new import is introduced, no cache-critical source module changes, and existing smoke stubs remain compatible because extra exports are harmless.

The requested code subagent could not start because the subagent runtime reported `published reply runtime missing for main`; this artifact records the main-run synthesis needed to continue.
