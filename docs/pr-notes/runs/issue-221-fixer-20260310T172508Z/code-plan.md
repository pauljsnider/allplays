Thinking level: medium
Reason: existing repo already contains a prior fix for admin invite persistence; this run needs a narrow follow-up on read-time discovery/access.

Plan:
1. Add failing tests for profile-email fallback in `tests/unit/team-access.test.js` and dashboard wiring.
2. Update `js/team-access.js` to normalize from `user.email || user.profileEmail`.
3. Update `js/auth.js` to attach `profileEmail` and backfill `user.email` when missing.
4. Update `dashboard.html` to query teams with `profile?.email || user.email`.
5. Run focused Vitest coverage, then commit.
