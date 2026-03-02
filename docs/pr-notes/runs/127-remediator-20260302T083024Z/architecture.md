# Architecture Role Notes

- Current state: Shared cleanup helper exists but is only invoked in `parent_invite` branch.
- Proposed state: Wrap `admin_invite` redemption call in `try/catch`; on failure invoke cleanup helper with created user and rethrow.
- Blast radius: Low; contained to one conditional branch in `executeEmailPasswordSignup`.
- Control impact: Improves consistency and limits orphan auth accounts on transactional failures.
