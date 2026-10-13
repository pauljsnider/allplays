# QA analysis

Focused regression coverage should submit 20 valid PDF files through the real legacy form listener and assert:

1. `reserveTeamMediaOrderRange(teamId, folderId, 20)` runs exactly once.
2. Its invocation precedes every `uploadTeamMediaFile` invocation.
3. All 20 helpers receive the corresponding sequential reserved value and no duplicates.
4. A middle helper rejection reports one failed row while the following helper retains the next reserved order, demonstrating that gaps are allowed rather than reused.
5. A malformed non-sequential reservation fails every row before any helper invocation.
6. Existing refresh, aggregate alert, and input cleanup behavior remains intact.

The nearest validation command is `npx vitest run tests/unit/team-media-legacy-upload-forms.test.js --reporter=verbose`.

The requested QA session could not start because `sessions_spawn` returned `published reply runtime missing for main`; this artifact records the QA-role analysis completed by the main run.
