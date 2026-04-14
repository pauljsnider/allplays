## Acceptance Criteria
1. A coach opening `help.html` can still discover workflows, filter results, and open the file-by-file reference from a visible link on the Help Center.
2. A parent or family user is not exposed to broken help navigation, the Help Center and page-reference page only advertise shipped `.html` destinations.
3. An admin reviewing help content can open `help-page-reference.html`, see expected sentinel rows such as `edit-schedule.html`, `live-game.html`, and `help-page-reference.html`, and return to the Help Center.
4. The unit integrity test for `help-page-reference.html` passes on supported contributor environments, including Windows, macOS, and Linux, without false failures caused by path parsing.
5. The Windows-safe fix must preserve the existing product expectation, no user-visible Help Center behavior regresses while the test harness is corrected.

## User Risks
- Coaches lose trust in the Help Center if release confidence drops and stale page references slip through.
- Parents may hit dead-end help links and turn to manual support during time-sensitive team tasks.
- Admins and program operators face higher cleanup and support burden if cross-platform CI noise causes teams to ignore or weaken integrity coverage.
- A flaky Windows-only failure is especially risky because it hides a content quality safeguard behind an engineering environment issue, not a real product issue.

## Scope Boundaries
- In scope: cross-platform reliability of `tests/unit/help-page-reference-integrity.test.js` and preservation of current Help Center/page-reference behavior.
- In scope: ensuring the test continues to protect against stale `.html` references listed in help content.
- Out of scope: Help Center redesign, workflow IA changes, role taxonomy changes, or expanding the page-reference page beyond this PR’s current content.
- Out of scope: broader filesystem utility refactors unless they are required to remove the Windows path failure from this specific test.

## Recommended Test Expectations
- Keep the smoke expectations already covering Help Center discovery, filter behavior, page-reference navigation, and workflow navigation.
- Require the unit test to resolve repo paths through a filesystem-safe path conversion approach (`fileURLToPath` pattern), not raw URL pathname parsing.
- Keep the sentinel assertions for `edit-schedule.html`, `live-game.html`, and `help-page-reference.html` so the user-facing help surface stays anchored to meaningful pages.
- Keep the existence check focused on shipped `.html` files only, so the test stays fast, deterministic, and useful in CI across platforms.
- If reviewers want an extra regression guard, add a narrow expectation or helper boundary that prevents reintroducing `URL.pathname`-based repo-root resolution in this test.
