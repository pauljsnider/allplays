Objective: fix lineup resume without broad tracker refactoring.

Current architecture:
- `js/live-tracker.js` owns tracker state initialization and Firestore persistence.
- Small pure helpers already exist for resume clock state and opponent stat hydration.

Proposed architecture:
- Introduce a small pure helper for lineup restoration and sanitization.
- Import it into `live-tracker.js` and apply it only when `shouldResume` is true.

Why this path:
- Keeps logic testable without DOM or Firebase mocks.
- Matches existing repo pattern of extracting pure resume logic into dedicated modules.
- Minimizes blast radius to one new helper, one new test file, and one call site in init.

Controls:
- Filter restored lineup to current roster IDs only.
- De-duplicate player IDs.
- Put any roster players not restored to `onCourt` onto `bench`.
- Preserve explicit reset path behavior.

Rollback:
- Revert the helper import and the single resume assignment block.

Evidence that would change this approach:
- If another initialization step intentionally rebuilds lineup from a different canonical source after resume.
- If saved `liveLineup` is known to be incomplete or untrusted relative to another persisted model.
