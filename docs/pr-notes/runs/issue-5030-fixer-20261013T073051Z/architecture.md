# Architecture analysis

## Integration point

`js/team-media.js` owns the legacy form orchestration. Its `uploadSelectedFiles` helper creates progress rows, optionally reserves orders, invokes the injected upload helper, reloads the library, and reports aggregate success/failure. `js/db.js` owns the transaction primitive and storage cleanup.

For a single selected document, the narrow integration is inside the existing `reserveOrders` block: call `reserveTeamMediaOrderRange(teamId, folderId, 1)`, retain its sole value, and only then enter the upload loop. The existing `try`/`catch` around reservation and each upload must remain intact.

## Minimal design

- Add an explicit one-file branch in `uploadSelectedFiles` that requests count `1` and stores the returned order as a one-element array.
- Leave the existing range call unchanged for selections larger than one.
- Keep `reserveOrders: true` on the document form and photo form.
- Do not modify `js/db.js`, import signatures, cache-bust values, or smoke module stubs.

## Failure behavior

Reservation failure is copied into each row through the existing `reservationError` flow and prevents helper invocation. Upload failure remains owned by `uploadTeamMediaFile`, whose catch deletes the uploaded storage object best-effort and rethrows. The form retains the reserved gap, reloads the library, and reports the failure.

## Recurrence risk

Low after a form-level test asserts exact count, call ordering, order propagation, and failed-upload reporting. The main risk is future callers bypassing the shared reservation option.

## Role execution note

The requested `allplays-architecture-expert` skill was unavailable, and the accepted collector session failed before producing output with `published reply runtime missing for main`. This artifact records the main-run synthesis.
