Objective: add regression coverage for issue #466 and validate the post-game summary workflow.

Primary regression to catch:
- Generated AI summary remains savable after preview cancel/close and textarea clear.

Test strategy:
- Add a focused unit test against `track-statsheet.html` source that fails if save still falls back to `generatedSummary`.
- Assert cancel/close logic clears both preview visibility and cached generated text.
- Assert generation and explicit "Use Summary" wiring remain present so the happy path is still covered.

Manual validation targets:
1. Generate AI summary, cancel preview, clear textarea, click Save & Continue, confirm no summary is written.
2. Generate AI summary, keep or edit text in textarea, click Save & Continue, confirm saved summary matches textarea.
3. Enter a manual summary without using AI, click Save & Continue, confirm manual text saves.

Residual risk:
- Coverage is source-level, not browser-executed, so runtime DOM regressions outside the changed logic still rely on manual validation.
