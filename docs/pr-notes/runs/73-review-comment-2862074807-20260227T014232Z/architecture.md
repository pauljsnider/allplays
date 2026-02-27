# Architecture Role Summary

- Current state: parent-invite signup has side effects across auth + Firestore invite linkage/redeem.
- Proposed state: compensate invite redemption best-effort, but make auth-account deletion one-way guarded by `inviteRedeemed === false`.
- Blast radius reduction: avoids cross-system partial-failure state of consumed invite + deleted auth principal.
- Tradeoff: may retain an auth principal with incomplete profile on post-redeem failures; preferred over unrecoverable invite loss.
- Controls equivalence: improved recoverability and lower operational repair burden; no broader access expansion introduced.
