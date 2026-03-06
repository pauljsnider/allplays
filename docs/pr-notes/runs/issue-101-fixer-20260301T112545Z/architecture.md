# Architecture Role Output

## Current State
`signup()` catches parent-invite linking errors and suppresses them. The function resolves and caller redirects to verification page.

## Proposed State
In parent-invite branch, treat linking/profile failure as fatal by rethrowing from catch. This preserves transactional behavior with rollback semantics performed by lower layers.

## Controls and Reliability
- Control equivalence improves: success is now coupled to completed invite link.
- Blast radius reduced: only parent-invite signup result handling changes.
- Existing verification email logic remains gated by a valid current user, but now this path is not treated as success after rollback.

## Tradeoff
- Users now see immediate error instead of false success; transient backend failures surface to UI (correct behavior).
