Objective: fix the unresolved PR #414 review comment on `tests/smoke/edit-config-platform-admin.spec.js`.

Current state:
- `edit-config.html` imports `./js/edit-config-access.js?v=1`.
- The smoke test mocks other browser-loaded modules but not `edit-config-access.js?v=1`.
- Missing that route can cause the page to load the real module instead of a deterministic stub during the smoke test.

Proposed state:
- Add a targeted mock route for `edit-config-access.js?v=1` inside `mockDependencies(page)`.
- Keep behavior aligned with the test intent: platform admin is allowed and the team object remains available.

Risk surface and blast radius:
- Low. Only the smoke spec stub setup changes.
- No production code behavior changes.

Assumptions:
- The review comment is accurate and only this missing module mock needs remediation.
- No role-orchestration skill or session spawning tool is available in this run, so inline analysis is sufficient.

Recommendation:
- Implement the missing mock directly in the spec and avoid broader refactoring.
