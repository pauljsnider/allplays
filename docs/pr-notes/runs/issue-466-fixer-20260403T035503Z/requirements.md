Objective: prevent rejected or cleared AI summaries from being saved in the post-game stat editor flow.

Current state:
- `track-statsheet.html` stores AI output in a module-level `generatedSummary`.
- Canceling or closing the preview only hides UI state.
- Saving uses textarea content or falls back to `generatedSummary`, which overrides explicit user intent to clear the summary.

Proposed state:
- Save only the current textarea value.
- Treat cancel or preview close as rejection of the generated draft by clearing the in-memory generated summary.
- Preserve the existing flow where accepted AI text is still editable in the textarea before save.

Risk surface and blast radius:
- Scope is limited to the post-game stat editor summary step in `track-statsheet.html`.
- Main regression risk is breaking the AI-assisted summary happy path or preventing manual summaries from saving.
- No tenant boundary, auth, or PHI blast radius change. This is client-side workflow state only.

Assumptions:
- The textarea is the source of truth for what should be persisted.
- Cancel and close mean "do not keep this generated draft" unless the user reuses or re-enters content.
- Existing unit tests may validate wiring by source inspection rather than browser execution.

Recommendation:
- Add a regression test that encodes the expected behavior around cancel/clear and save.
- Make the minimal code change to clear stale generated state and remove the save fallback.

Success criteria:
- A blank textarea results in no summary save.
- Canceling or closing the AI preview does not leave generated text eligible for later save.
- Manual text and accepted AI text still save normally.
