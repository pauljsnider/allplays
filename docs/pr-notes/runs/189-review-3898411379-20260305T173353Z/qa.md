# QA Role (Fallback Manual Synthesis)

## Primary Regression Guardrails
1. Same-ms message arrival increments unread exactly once.
2. Existing snapshot replay does not double count.
3. Chat expand action resets unread and cursor tie-break fields.

## Test Additions
- Added targeted unit case for same-millisecond messages in `tests/unit/live-tracker-chat-unread.test.js`.

## Validation Notes
- Automated unit execution unavailable in this checkout because test dependencies are not installed (`vitest` missing and no package manifest/lock in branch snapshot).
- Syntax validation executed with `node --check` on modified JS modules.
