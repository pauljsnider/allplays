# Issue 2316 Architecture

## Current state
- `TeamSettings.tsx` and `TeamCertificates.tsx` each hand-roll primary page-load `loading/error/try/catch/finally` behavior.
- Async UX drifted from the existing app convention already used in pages like Home and Schedule.

## Proposed state
- Use `useAsyncOperation` for the primary load on both pages.
- Keep domain-specific synchronous state local to each page.
- Gate first paint with an explicit initial-load resolution flag so the route does not briefly render fallback or redirect UI before the first async attempt resolves.
- Provide a consistent blocking error state with Retry on both pages.

## Root-cause framing
- The defect exists because these staff workflows were implemented before the shared async hook became the page-level standard, leaving duplicated lifecycle code and no consistent retry affordance.

## Blast radius
- Limited to two React app routes and their page tests.
- No Firestore schema, permission, or service-layer behavior changes.

## Rollback
- Revert the two page components and associated tests. No persisted-data rollback is needed.