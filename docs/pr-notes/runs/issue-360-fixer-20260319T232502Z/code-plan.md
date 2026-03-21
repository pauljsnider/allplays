# Code Role (allplays-code-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-code-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent implementation plan.

## Plan

1. Add a small rideshare controller module for child-selection resolution and request/cancel handlers.
2. Wire `parent-dashboard.html` to use the new module while preserving existing UI markup and `window.*` handlers.
3. Add failing Vitest coverage for child-B request selection, existing-request selection preference, and cancel rerender side effects.
4. Run focused tests, then the relevant rideshare suite, and commit with an issue-linked message.
