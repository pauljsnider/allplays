# Code role plan (inline fallback)
1. Modify redeemAdminInviteAtomicPersistence in js/db.js.
2. Capture pre-grant user snapshot and flags for existing coach access.
3. Add best-effort rollback if transaction fails after user grant.
4. Keep existing atomic transaction for team/code writes unchanged.
