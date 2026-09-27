# Requirements

## Problem Statement

Firestore rules still let an authenticated, verified, linked parent create a schema-valid `coparent_invite` access code directly. That path bypasses the protected callable now used by the Player workflow, including its authoritative linkage checks, rate limiting, and idempotency.

## User Segments Impacted

- Linked parents must use the protected callable to create co-parent invitations.
- Other authenticated clients must not mint co-parent invitations.
- Coaches and administrators retain existing permissions for other invite types.
- Invite recipients retain existing redemption and membership-grant behavior.

## Acceptance Criteria

1. A linked parent cannot directly create a `coparent_invite` access code through the Firestore client.
2. An unrelated authenticated user cannot directly create a `coparent_invite` access code.
3. A fully schema-valid payload remains denied, including matching `generatedBy`, code ID, and exact player linkage.
4. Valid standard and `parent_invite` client creation remain permitted for their existing authorized actors.
5. Existing callable creation, co-parent redemption, and membership grants remain unchanged and covered.
6. The focused access-code rules test runs under the Firestore emulator in CI.

## Non-Goals

- Callable implementation changes.
- Player or legacy parent-dashboard UI changes.
- Authorization changes for other invite types.
- Changes to co-parent redemption or membership-grant semantics.

## Edge Cases

- Linked parent with exact `parentPlayerKeys` linkage and a valid payload is still denied.
- Unrelated verified client with a valid payload is denied.
- Standard and manager-created parent invites still succeed.
- Existing server-created co-parent records remain redeemable.

## Open Questions

No blocking questions. The legacy parent dashboard still uses direct creation and will be denied by this boundary; migrating it is outside this slice.
