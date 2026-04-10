Current state:
- The dashboard handler performs two checks in sequence: `validateAccessCode()` and then `redeemParentInvite()`.
- Those functions do not choose duplicate code documents the same way, so the earlier check can reject a code that the later path would redeem successfully.

Proposed state:
- Keep one source of truth for manual parent invite redemption in this flow: `redeemParentInvite()`.
- Preserve the duplicate-aware selection already implemented in `js/db.js`, including transaction-time `used` and `expiresAt` enforcement.

Blast radius:
- Limited to the inline redeem button handler in `parent-dashboard.html`
- No changes to other invite flows or shared DB logic

Tradeoffs:
- Removing the pre-check sacrifices earlier UX messaging from `validateAccessCode()`, but avoids a correctness bug that blocks valid redemption.
- The authoritative transaction already provides the necessary control equivalence for expiry and reuse.

Recommendation:
- Make the minimal page-level change and keep all correctness enforcement in the DB helper that already understands duplicate parent invite docs.
