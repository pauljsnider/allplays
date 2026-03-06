# Requirements Role Output

## Problem Statement
New-team admin invite processing must never attempt email delivery without a valid invite code and must never retain stale pending invite emails after a save attempt, or coaches/admins can see failed invites, duplicate sends, or inconsistent follow-up behavior.

## User Segments Impacted
- Coach/team owner creating a new team and inviting assistant coaches/admins.
- Invited admin receiving activation email or fallback code.
- Program admin responsible for support follow-up when invites fail.

## Acceptance Criteria
1. Invite processing skips `sendInviteEmail` whenever invite code is missing/blank and records deterministic fallback status (`missing_invite_code`).
2. New-team pending invite queue is cleared after processing attempt, including failure paths during invite processing, so a later save cannot replay stale emails.
3. Existing dedupe behavior remains intact: duplicate/case-variant emails are normalized and processed once.
4. Team creation/edit flows still complete without runtime errors when invite service returns partial/malformed data.

## Non-Goals
- No redesign of invite UX copy.
- No Firestore schema/rules changes.
- No changes to invite code generation service behavior.

## Edge Cases
- `inviteAdmin` returns `null`, missing object, or non-string `code`.
- Invite email service throws for one recipient while others succeed.
- User removes an admin from the local list before save.

## Open Questions
- None required for this PR scope; behavior can be safely hardened in client logic.
