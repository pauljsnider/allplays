# Architecture analysis

`js/team-media.js` already centralizes legacy photo and document batch handling in `uploadSelectedFiles`. Prerequisite commits wire the document form through `reserveTeamMediaOrderRange`, await the single reservation before entering the per-file loop, and pass `orders[index]` to `uploadTeamMediaFile`.

That implementation preserves the important boundary: the Firestore reservation primitive owns range allocation, while the form owns deterministic index mapping and per-file UI state. The document form now opts into a narrow sequential-range invariant before entering the helper loop. This prevents a malformed multi-item reservation from invoking any document helper, while leaving the single-document and photo slices unchanged.

The requested architecture session could not start because `sessions_spawn` returned `published reply runtime missing for main`; this artifact records the architecture-role analysis completed by the main run.
