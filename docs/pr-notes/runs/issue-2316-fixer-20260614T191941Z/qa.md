# Issue 2316 QA

## Failing invariant
- Staff pages should use one consistent initial-load state machine with a recoverable retry path.
- Team Settings must not reload and wipe unsaved edits when a coach selects a new photo preview.

## Regression plan
- Update `apps/app/src/pages/TeamSettings.test.tsx` to cover:
  - initial load failure -> blocking error -> Retry -> success
  - choosing a new photo does not trigger a second load or wipe unsaved edits
- Add `apps/app/src/pages/TeamCertificates.test.tsx` to cover:
  - initial load failure -> blocking error -> Retry -> success

## Smallest validation
- `npm --prefix apps/app exec vitest run src/pages/TeamSettings.test.tsx src/pages/TeamCertificates.test.tsx --reporter=verbose`

## Post-fix manual spot checks
- Staff can recover from transient load failures on both pages.
- Team Settings keeps draft edits after picking a new photo.
- Non-staff access behavior remains unchanged.