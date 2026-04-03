Objective: close a client-side state leak in the stat-sheet-to-game-report workflow.

Current architecture:
- `track-statsheet.html` contains inline workflow logic.
- AI generation writes to both preview UI and textarea while also retaining the draft in `generatedSummary`.
- Save derives persisted summary text from two sources: textarea first, then cached AI output.

Proposed architecture:
- Keep the textarea as the single persisted source of truth.
- Keep `generatedSummary` only as transient draft state for preview and "Use Summary".
- Clear transient draft state when the user dismisses the preview so rejected content cannot be reused implicitly.

Tradeoffs:
- This is the smallest safe patch and avoids larger refactors such as extracting inline handlers to a dedicated module.
- Clearing `generatedSummary` on cancel means "Use Summary" after cancel is not possible without regenerating, which matches the explicit reject action.

Controls and blast radius:
- No backend schema, Firestore rule, or API contract changes.
- Rollback is trivial: revert the single page and regression test if unexpected behavior appears.
- Instrumentation remains manual through the existing workflow and unit tests.
