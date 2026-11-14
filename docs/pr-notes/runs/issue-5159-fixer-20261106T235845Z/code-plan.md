# Code plan

1. Export `listParentRegistrationApplicationsPage` from `legacyParentTools.ts` through `callLegacyDb`.
2. Add typed application, cursor, error, page, and loader-option models to `parentRegistrationsService.ts`.
3. Add `loadParentRegistrationApplicationsPage`, requiring an authenticated UID and passing only a verified email.
4. Add a co-located service test proving delegation and exact preservation of pagination and partial-error metadata.
5. Run the focused Vitest file and app typecheck, then commit the implementation and test together.

Recurrence risk is low because the app boundary will have direct contract coverage while the existing legacy suite continues to own query semantics.
