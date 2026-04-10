# Architecture role notes
- No `allplays-orchestrator-playbook` skill or session spawning tools are available here; fallback inline analysis used.
- Existing design already routes admin invite redemption through `redeemAdminInviteAtomically(codeId, userId)`.
- Smallest safe change: ensure transaction derives user email reliably (profile doc or auth fallback) before `adminEmails` merge, keeping all writes in same transaction.
- Blast radius: constrained to admin invite redemption path in `js/db.js` and corresponding unit tests.
