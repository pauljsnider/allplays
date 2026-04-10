Objective: eliminate duplicated smoke URL resolution logic so subpath-mounted environments behave consistently.

Current state:
- Shared helper path builder is already correct.
- Footer smoke spec bypasses it with an older inline implementation.

Proposed state:
- One canonical smoke URL builder in `tests/smoke/helpers/boot-path.js`.
- Footer smoke spec imports that helper and inherits the same cache-busting and base-path preservation behavior as auth/bootstrap smoke tests.

Why this path:
- Smallest change that fixes the reported failure mode.
- Reduces future drift by removing duplicate URL construction logic.
- Keeps the blast radius inside test code.

Controls:
- No production code changes.
- Regression check validates the exact subpath case raised in review.
- Existing footer smoke navigation coverage remains intact.

Rollback:
- Revert the single smoke-spec patch if it creates unexpected harness instability.
