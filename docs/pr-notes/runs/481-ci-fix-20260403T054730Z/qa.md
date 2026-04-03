Objective: validate the failing preview smoke cases after correcting test setup.

Evidence:
- CI failed only in `tests/smoke/track-statsheet-apply.spec.js`.
- Both failures throw `SecurityError` on `localStorage` inside `seedScenario`.
- The failure occurs before assertions tied to app behavior, so the test harness is the defect source.

Validation plan:
- Run the targeted Playwright smoke spec with `playwright.smoke.config.js`.
- Confirm both previously failing tests pass.
- Avoid broad suite changes because the requested fix is scoped to one CI failure.

Skill note:
- `allplays-orchestrator-playbook`, `allplays-architecture-expert`, `allplays-qa-expert`, and `allplays-code-expert` were requested by instruction but are not available in this session’s skill list, so analysis was completed inline.
