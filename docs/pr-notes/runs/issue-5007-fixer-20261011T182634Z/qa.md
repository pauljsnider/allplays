# QA analysis

## Regression strategy

Add focused component coverage in `apps/app/src/pages/StandardTracker.test.tsx`:

1. An authorized scorekeeper opens a draft and sees explicit unsaved/local-only guidance.
2. Typed fallback text survives start, stop, edit, and cancel transitions.
3. Discard clears content, closes the workflow, and restores the launcher.
4. Draft interactions do not call `recordEvent`, `undoLastEvent`, `adjustGameScore`, or `localStorage.setItem`, and do not change score, event count, or stat tallies.
5. Parent-only and unsupported-engine access cannot see the launcher or editor.

The lifecycle test fails before the implementation because no draft controls or state exist. Negative mutation assertions prevent the nearby tracker persistence paths from being reused accidentally.

## Smallest validation

```bash
npm --prefix apps/app exec -- vitest run src/pages/StandardTracker.test.tsx --reporter=verbose
npm run app:build
```

No focused game-hub test is required unless `ScheduleGameHubSection.tsx` changes.

## Recurrence risk

Medium: persistence and backend mutation paths are adjacent to the new UI. Prevent recurrence by keeping transient drafts callback-free and testing both authorization and absence of mutations.
