# Code plan — issue #4811

> The requested `allplays-orchestrator-playbook` and `allplays-code-expert` skills were unavailable in this runtime. ClawHub discovery could not run because the `openclaw` CLI is not installed. The mandated `/home/paul-bot1/automation/docs/bug-rca-playbook.md` path also does not exist. OpenClaw role sessions failed before execution because the main agent lacks a published-reply runtime; four native read-only role reviews were used as the closest available fallback. Only the main run will edit, test, and commit.

## Synthesis

All roles agree that the defect is the combined `allow read`, and that the safe fix is a `get`/`list` split with unchanged authorization. The only lifecycle ambiguity was whether all terminal states should bypass the cap; it is resolved conservatively in favor of only `completed` and `final`, matching current replay consumers and the issue's replay wording. Cancelled, deleted, malformed, and still-active games remain bounded.

## Test-first implementation

1. Update `tests/unit/firestore-live-chat-auth.test.js` first:
   - import `limit`;
   - codify the separate get/list source contract and lifecycle/limit predicate;
   - seed active, private-parent, unauthorized, and completed/final live events;
   - add emulator cases for missing, accepted, and excessive limits, point reads, replay, and authorization;
   - make the Diamond list assertion bounded so it still tests Diamond isolation.
2. Run the focused source test before the rule change and retain the expected failure as evidence that the regression detects the defect.
3. Update only the `liveEvents` match in `firestore.rules` with one compact helper and separate `allow get`/`allow list` clauses. Leave writes and all adjacent collections unchanged.
4. Run the focused emulator-backed test and `npm run ci:firebase-rules`; record compacted size/budget evidence.
5. Review the diff, stage all issue files, and commit with an imperative message referencing #4811. Do not push or create a pull request.

## Prevention / learning

Whenever point reads and list queries have different resource-cost contracts, Firestore rules must use separate `allow get` and `allow list` clauses. Client limits are not a security or billing boundary; pair emulator denials for missing/excessive limits with source assertions for invalid query shapes that the SDK cannot send.
