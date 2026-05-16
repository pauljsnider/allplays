# QA Plan

- Run the family plan unit tests.
- Verify tests assert access-code revocation happens before membership removal.
- Verify tests assert no direct `users/{member.userId}` or `teams/{teamId}/players/{playerId}` revocation writes happen in `removeFamilyMember`.
- Verify Firestore rules contain `data.accessStatus == 'revoked'` for removal validation.
