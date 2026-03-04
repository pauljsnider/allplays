# Code Plan
1. Update candidate selection in `redeemParentInvite` to inspect all matched docs.
2. Select first `parent_invite` doc that is both unused and unexpired.
3. Fall back to first `parent_invite` doc (for legacy error paths) if no usable candidate exists.
4. Keep transaction checks unchanged to preserve correctness under races.
