# Requirements Analysis
- Objective: Resolve PR thread PRRT_kwDOQe-T585yHspq by preventing false negatives when redeeming duplicated parent invite access codes.
- Current behavior risk: `redeemParentInvite` selects first `parent_invite` code doc by matching `code` only, then fails if that one is already used even when another unused duplicate exists.
- Required behavior: choose an unused, unexpired `parent_invite` document among matched duplicates before claiming in transaction.
- Scope: Minimal update in code-selection logic only; preserve existing transaction claim and side-effect flow.
