# Code Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-code-expert`) and `sessions_spawn` are not available in this environment. This artifact captures equivalent implementation plan.

## Implementation plan
1. Inspect `js/live-game.js` speed button handler for rebase ordering.
2. Add/adjust unit test coverage in `tests/unit/live-game-replay-speed.test.js` to explicitly encode issue #142 scenario (1x->4x jump prevention at ~10s).
3. If test exposes a gap, apply minimal patch in replay speed handling or helper.
4. Run targeted Vitest file via shared workspace Vitest binary.
5. Stage only relevant files and commit with issue reference.

## Non-goals
- No refactor of replay loop architecture.
- No UI/visual changes outside replay timing behavior.
