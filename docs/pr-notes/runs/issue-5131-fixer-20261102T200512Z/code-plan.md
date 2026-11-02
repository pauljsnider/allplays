# Code Plan

> Fallback artifact: the requested code subagent was dispatched, but the runtime rejected the role before execution. This analysis was completed in the main lane from repository and issue evidence.

1. Add a regression case to `tests/unit/help-team-context-links.test.js` using `workflow-team-media.html` and its Team Communication link.
2. Extend `preserveHelpBackLinkContext` in `js/help-context.js` to rewrite same-origin anchors in the Related Workflows section in addition to Back links.
3. Keep the exported function name for compatibility and retain the existing context allow-list.
4. Run the single focused Vitest file, inspect the diff, and commit both test and implementation with issue #5131.

## Compatibility

All workflow pages already load `js/help-context.js?v=1`; no new import or module stub is introduced. The module is not in the repository's cache-critical list, so the targeted patch does not require a transitive cache-bust cohort update.
