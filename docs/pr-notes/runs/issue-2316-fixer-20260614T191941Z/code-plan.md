# Issue 2316 Code Plan

## Minimal patch shape
- `apps/app/src/pages/TeamSettings.tsx`
  - replace page-local primary-load lifecycle with `useAsyncOperation`
  - add a first-load resolution guard
  - add Retry CTA for initial-load failure
- `apps/app/src/pages/TeamCertificates.tsx`
  - replace page-local primary-load lifecycle with `useAsyncOperation`
  - add a first-load resolution guard
  - add Retry CTA for initial-load failure
- Tests
  - extend `apps/app/src/pages/TeamSettings.test.tsx`
  - add `apps/app/src/pages/TeamCertificates.test.tsx`

## Hazards
- Do not let first render redirect before the initial async load has resolved.
- Do not tie reload behavior to photo preview state changes.
- Keep the patch focused on primary load behavior only.

## Validation target
- Focused Vitest page tests only.