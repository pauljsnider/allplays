# Requirements Role Notes

## Objective
Prevent accidental team creation when user opens `edit-team.html?teamId=...` and submits before edit data finishes loading.

## User Risk
- Current state risk: submit can follow create path while edit context is still unresolved.
- Blast radius: duplicate team records, owner/admin confusion, downstream schedule/roster split.

## Acceptance Criteria
- Edit mode is determined immediately from URL param before async team fetch.
- Submit is blocked while page initialization is pending.
- On edit URLs, save path calls `updateTeam` once initialization completes.
- On create URLs (no `teamId`), create flow remains unchanged.

## Controls
- No PHI handling changes.
- No access control weakening.
