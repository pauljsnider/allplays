# Architecture Decisions

- Keep the change isolated to `workflow-live-watch-replay.html` and correct the initial hash lookup from `window.window.location.hash` to `window.location.hash`.
- Preserve the existing TOC event model for scroll, click, and `hashchange`; do not refactor surrounding logic in this remediation.
- Treat `test-workflow-mobile-toc-active-state.html` as the regression harness for first-render mobile TOC state.

# Blast Radius

- Affects only initial active-state setup on the workflow live watch replay page.
- No Firestore, auth, storage, routing, or permission behavior changes.
- No shared module or cross-page dependency changes.

# Controls And Rollback

- Control: one-line reversible patch with no data-model impact.
- Control: existing test page remains aligned with the production expression for active-state initialization.
- Rollback: revert the one-line hash lookup change if an unexpected regression appears.

# Recommendation

Ship the one-line fix and validate the workflow replay page plus the dedicated mobile TOC regression page. This preserves current behavior while removing the runtime failure on first render.
