# QA role (inline fallback)

Subagent orchestration tools/skills are unavailable in this execution context, so this is an inline QA pass.

## Validation plan
1. Open `help.html` locally and confirm cards render for each role.
2. Enter search text and confirm count and list update.
3. Click bottom navigation links and verify anchor scroll works.
4. Spot-check escaping with synthetic values containing `<`, `>`, `\"`, `'`, and `&` (if test data can be injected).

## Regression focus
- Bottom nav links must still target rendered section IDs.
- Result summary should remain unchanged.
