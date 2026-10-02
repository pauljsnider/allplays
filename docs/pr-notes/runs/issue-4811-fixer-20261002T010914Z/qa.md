# QA analysis — issue #4811

> The requested `allplays-qa-expert` skill was unavailable in this runtime. OpenClaw role sessions could not start because the main agent lacks a published-reply runtime, so a native read-only QA subagent performed this analysis.

## Prevention-oriented coverage

Extend `tests/unit/firestore-live-chat-auth.test.js` with:

- source assertions that `liveEvents` separates `allow get` and `allow list`, has no generic `allow read`, and requires a non-null limit greater than zero and no greater than 20 for non-replay games;
- source assertions that either `status` or `liveStatus` in `completed`/`final` bypasses only the cap;
- emulator denials for active authorized lists without a limit and with `limit(21)`;
- emulator success for active authorized `limit(1)` and `limit(20)` queries, including public/shareable and parent-authorized private paths;
- emulator success for authorized active-game point reads and unbounded completed/final replay lists;
- continued denials for unauthorized private reads and Diamond-backed legacy reads.

The Web SDK rejects zero or negative `limit()` values before they reach the emulator, so `request.query.limit > 0` needs source-contract coverage. The existing Diamond list test must use a valid bounded query; otherwise it could pass because of the new missing-limit denial instead of proving Diamond isolation.

## Validation

Run the focused Firestore-emulator test and `npm run ci:firebase-rules`. The latter compacts the rules and enforces the existing 132 KiB deployment budget.

Recurrence risk is medium because completion uses two fields and the compiled rules artifact has limited headroom.
