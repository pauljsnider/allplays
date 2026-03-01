# Code Role (manual fallback)

Required allplays orchestration skills/subagent tooling were requested but are unavailable in this runtime, so this is a manual role synthesis artifact.

## Plan
1. Add failing unit test asserting selected filter child (`selectedChildId`) overrides broad button `childIds`.
2. Update `resolveRsvpPlayerIdsForSubmission` to prioritize `selectedChildId` before other explicit child contexts.
3. Update `submitGameRsvpFromButton` to include selected filter child in child context.
4. Run targeted RSVP unit tests.
5. Commit test + fix referencing issue #110.
