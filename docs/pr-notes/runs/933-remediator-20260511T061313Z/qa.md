# QA Plan

- Run the targeted officiating unit guard: `npx vitest run tests/unit/officiating-slots.test.js`.
- Verify source guards no longer contain `playerTeamIds` for open officiating slot claim eligibility.
- Manual follow-up for PR: sign in as owner/admin/parent and verify open slot claim remains visible and claim succeeds; sign in as unrelated user and verify open slots are hidden and direct update is denied.
