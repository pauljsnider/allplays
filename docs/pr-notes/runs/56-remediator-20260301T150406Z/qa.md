# QA role (fallback inline)

Risk-focused checks:
1. Parent creates request on open offer: allowed.
2. Parent attempts create request on closed/cancelled offer via direct write: denied.
3. Parent attempts update `status` from confirmed to pending: denied.
4. Driver/admin status decision path still works for confirmed/waitlisted/declined with seat counter invariant.
5. Modal child picker: switching child updates visible Request/Cancel controls and status text.

Execution constraints:
- Repo has no automated tests for rules/UI; perform targeted static validation and note manual verification steps.
