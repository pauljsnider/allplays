# QA Role (fallback inline)

## Verification focus
- Admin invite redemption succeeds when user profile email is missing but auth email exists.
- Admin invite redemption can update team adminEmails after coachOf grant.

## Test approach
- Static checks and code-path validation in affected files.
- Repo has no automated suite; perform targeted command validation and sanity review.
