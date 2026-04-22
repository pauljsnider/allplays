# Implementation Plan
- Update `extractEditTeamModule()` in `tests/unit/edit-team-admin-access-persistence.test.js` to replace the new `stat-config-presets` import with an injected dependency, the same way the test already replaces other imports.
- Add a minimal `statConfigPresets` stub to the injected deps object so the extracted script can evaluate during the test.
- Do not modify `edit-team.html` or application logic.

# Acceptance Criteria
- The suite no longer throws `SyntaxError: Cannot use import statement outside a module`.
- Only the failing test harness and required run notes are changed.
