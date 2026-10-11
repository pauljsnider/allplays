# Code plan

## Exact missing behavior

The mobile Standard Tracker has no component-local workflow for a reviewable, typed note draft. Existing score/stat actions persist immediately, so the feature requires a separate state boundary.

## Minimal patch

1. Add a private `VoiceNoteDraftPanel` and a `NoteDraftPhase` union to `StandardTracker.tsx`.
2. Keep draft phase/text exclusively in component state.
3. Render the keyed panel inside `!accessDenied && config`, before the scoring grid.
4. Provide explicit `Open note draft`, `Start voice draft`, `Stop voice draft`, `Edit note draft`, `Cancel voice draft`, and `Discard draft` controls.
5. Keep the textarea editable during editing/recording and read-only during review.
6. Include visible unsaved and no-microphone/no-save copy; omit any Save action.
7. Update `StandardTracker.test.tsx` with the complete lifecycle, no-mutation assertions, and denied-access assertions.

## Conflict resolution

The QA lane proposed making Cancel destructive, while the requirements and architecture lanes treated it as cancelling only the active voice attempt. The implementation uses the latter: Cancel preserves typed fallback text, while Discard is the single explicit destructive action. This produces distinct, predictable controls and avoids accidental data loss.

## Type and lint notes

- Use a string-literal phase union.
- Avoid effects, storage, and service callbacks.
- Use semantic labels/status text and existing utility classes.
- Key the child by user/team/game to isolate in-memory drafts across identities and routes.
