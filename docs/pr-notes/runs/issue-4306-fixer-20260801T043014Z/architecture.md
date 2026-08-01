# Architecture

## Current-State Read

At base/head `83b61c7d62efbc0b1239eaa2ffd475877155c0b4`, `/accessCodes/{codeId}` has an explicit `coparent_invite` create branch backed by `isCoParentInvitePayloadValid()`. The Player workflow now calls `createCoParentInvite`, whose Admin SDK transaction is not governed by client Firestore rules.

## Proposed Design

- Remove only the `coparent_invite` alternative from the access-code client create rule.
- Remove the now-unused payload helper to avoid preserving misleading authorization code.
- Add rules-emulator denials for linked and unrelated authenticated users.
- Add positive controls for standard and `parent_invite` creation.
- Register the access-code rules test in the existing emulator-backed CI command.

## Files And Modules Touched

- `firestore.rules`
- `tests/unit/access-code-rules.test.js`
- `package.json`
- This run's role artifacts under `docs/pr-notes/runs/issue-4306-fixer-20260801T043014Z/`

## Data/State Impacts

No schema or migration changes. Existing access-code records and redemption behavior are unchanged. New co-parent invite records must be written by trusted server code.

## Security/Permissions Impacts

Authorization fails closed for all client SDK actors. The blast radius shrinks from linked parents being able to mint records directly to only privileged server code creating them. Confirmation, retention, deletion, reload durability, and interrupted-browser behavior are unchanged. Callable transaction atomicity, rate limits, and idempotency remain the compensating controls.

## Failure Modes And Mitigations

- A malformed edit could affect sibling invite types. Emulator success controls protect standard and parent invites.
- Emulator cases could silently skip outside the emulator. The file is added to the emulator-backed CI command.
- The legacy parent dashboard direct-write path will receive permission denied. That known impact is outside this issue's Player-only migration scope.
