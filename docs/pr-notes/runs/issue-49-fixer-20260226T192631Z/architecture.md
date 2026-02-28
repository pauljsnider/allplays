# Architecture Role Notes (Fallback)

Objective: Close privilege-escalation gap from reusable admin invite codes.

Current -> proposed control equivalence:
- Current: Validation-only check in accept flow (read path only).
- Proposed: Preserve validation check and add post-success write to `accessCodes/{codeId}` (`used=true`, `usedBy`, `usedAt`).

Why this is minimal and safe:
- Reuses existing `markAccessCodeAsUsed` helper in `js/db.js`.
- No refactor of auth/link flow.
- No changes to code generation or expiration logic.

Blast radius comparison:
- Current blast radius: unlimited admin-level team joins from one leaked code.
- Proposed blast radius: single-account use per code; subsequent attempts blocked by existing validator.

Instrumentation and rollback:
- Evidence of redemption stored in `usedBy`/`usedAt` fields.
- Rollback is single-line call removal (not expected to be needed).
