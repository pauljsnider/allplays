# Code Role + Orchestrator Synthesis

## Patch Plan
1. Harden `redeemAdminInviteAtomicPersistence` input validation and preconditions.
2. Preserve batched atomic write behavior for team/user/code documents.
3. Wrap commit errors with explicit context.

## Acceptance Criteria
1. Team/user/access-code updates are committed atomically in one batch.
2. Invalid preconditions fail before commit with explicit errors.
3. Existing invite success UI flow remains unchanged.

## Architecture Decisions
- Keep `writeBatch` because it guarantees all-or-nothing across documents without adding a broader refactor.
- Add explicit doc existence checks before commit for predictable failure reasons.
- Use one `Timestamp.now()` value for all updated fields in the operation.

## QA Plan
- Run static syntax check on modified JS module.
- Verify git diff only touches targeted persistence function and required run artifacts.
- Provide manual verification checklist for Firestore document outcomes.

## Implementation Plan
- Edit `js/db.js` function `redeemAdminInviteAtomicPersistence` only.
- No changes to caller contract in `accept-invite.html` or `admin-invite-redemption.js`.

## Risks And Rollback
- Risk: stricter preconditions may surface failures that were previously silent.
- Mitigation: explicit error messages and unchanged transaction boundary.
- Rollback: revert commit affecting `js/db.js` if unexpected invite failures spike.

## Residual Risks
- Client-side flow still depends on eventual manual validation since automated tests are absent.

## Commit Message Draft
Harden admin invite atomic persistence preconditions
