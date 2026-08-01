# QA

## Risk Matrix

| Risk | Level | Guardrail |
|---|---|---|
| Linked parent bypasses the callable | High | Emulator denial using exact player linkage and a valid payload |
| Other authenticated client mints an invite | High | Emulator denial for an unrelated verified user |
| Adjacent invite permissions regress | Medium | Emulator success checks for standard and `parent_invite` creation |
| Redemption or membership grant regresses | High | Run existing co-parent workflow and callable-core coverage |
| Emulator assertions silently skip in CI | Medium | Add the test file to `test:storage-rules:ci` |

## Automated Tests To Add/Update

- Update static rules assertions so no co-parent client-create branch or helper remains.
- Add linked-parent and unrelated-user direct-create denials.
- Add standard access-code and manager-created parent-invite success controls.
- Run existing co-parent workflow and callable-core tests unchanged.

## Manual Test Plan

No local manual UI test is required for this rules-only slice. Post-deploy, verify the Player callable creates one invite and a recipient can redeem it.

## Negative Tests

- Linked parent direct `coparent_invite` create: denied.
- Unrelated authenticated direct `coparent_invite` create: denied.
- Valid payload with matching actor, code, timestamps, and exact linkage: still denied.

## Release Gates

- Focused Firestore emulator test passes.
- Existing co-parent creation/redemption coverage passes.
- Diff contains no callable, UI, redemption, or other invite authorization changes.
- GitHub CI remains the full integration gate.

## Post-Deploy Checks

- Confirm direct client creation is denied in a safe test context.
- Confirm the Player callable still creates and reuses invites.
- Confirm redemption updates user, player, trusted projection, and invite state atomically.
- Watch permission-denied logs for the known legacy parent-dashboard path.
