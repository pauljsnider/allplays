# Requirements

- Family membership removal may only mark `accessStatus` as `revoked`; arbitrary values must be rejected by Firestore rules.
- Removal must not mark the membership removed before revocation operations that the current client can actually perform complete successfully.
- The parent dashboard client must not attempt writes that normal parent organizers cannot authorize: `users/{member.userId}` profile edits or broad `teams/{teamId}/players/{playerId}` parent-array edits.
- Keep remediation scoped to PR review feedback and preserve the existing family membership shell record behavior.

## Acceptance criteria

1. Firestore rules validate `accessStatus == 'revoked'` for removal updates.
2. Access code revocation runs before membership status is updated.
3. `removeFamilyMember` no longer performs unprivileged member profile or player document edits from the browser.
4. Unit tests cover the revised order and rules validation string.
