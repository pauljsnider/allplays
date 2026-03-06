# Architecture Role Notes

Current state:
- `signup()` creates Firebase Auth user, then parent-invite linkage/profile writes.
- On failure in parent-invite path, function already attempts delete + signOut + rethrow.

Proposed state:
- Keep flow unchanged but harden cleanup call to guard nullable user and clearly target created user object.
- Preserve blast radius to parent-invite failure path only; do not alter standard signup or Google signup logic.

Risk/blast radius:
- Low and isolated to failure handling.
- Main risk is masking original error; mitigated by nested cleanup `try/catch` and final `throw e`.
