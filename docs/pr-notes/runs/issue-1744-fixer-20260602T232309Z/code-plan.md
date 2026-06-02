# Implementation Plan

1. Add a shared app-side push routing helper that maps payloads and legacy links to internal routes.
2. Extend `pushService.ts` with a native notification-open listener that stores pending route intent.
3. Update `App.tsx` to register the listener and consume pending routes after auth bootstrap.
4. Extend notification payloads in `functions/index.js` with additive `appRoute` and `eventId` fields.
5. Add focused unit and integration coverage, then run only the targeted Vitest files.

## Risks
- Duplicate navigation during auth bootstrap. Mitigate by clearing pending route once consumed.
- Incomplete payloads. Mitigate with safe fallback routes.
