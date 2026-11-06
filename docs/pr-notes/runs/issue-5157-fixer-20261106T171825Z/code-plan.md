# Code plan — Issue #5157

> The requested `allplays-code-expert` skill was unavailable; this plan follows repository guidance and the established legacy query contract.

## Patch plan

1. Export `listParentRegistrationApplicationsPage` through `legacyParentTools.ts`.
2. Add typed application, error, and page models plus a thin loader. Return an empty terminal page when unauthenticated; otherwise delegate UID/email and cursor.
3. Add independent submitted-history state to `RegistrationsTool.tsx`. Reset/load page one on user or refresh changes, merge by `registrationKey`, preserve cards during retry/load-more errors, and render separate sections.
4. Add focused service and component tests first, then implement until they pass.

## Pitfalls

Do not collapse the page response to an array, treat partial errors as total failure, clear successful cards before retry, share form/history loading state, add Firestore logic, or expose mutation controls. Check adapter-boundary tests after adding the export.
