# Issue #1998: Athlete Profile Media Parity

Draft PR anchor for #1998.

## Current Finding

The app can save athlete-profile drafts, and prior work added profile media draft
plumbing, but the remaining parity target is completing the parent-facing media
workflow without falling back to the legacy athlete profile builder.

## Implementation Scope

- Add app UI for headshot capture or library selection in the athlete profile
  flow.
- Upload headshots through the existing image-project path used by app-side team
  media.
- Save the resulting headshot URL on the same athlete profile draft field used
  by `js/athlete-profile-utils.js`.
- Add highlight clip link management with the same metadata shape and ordering
  expected by the legacy/public athlete profile surfaces.
- Keep media changes in the existing athlete profile draft save path; publishing
  remains out of scope for #1998.

## Acceptance

- A parent can add, preview, replace, and save an athlete headshot in the app.
- A parent can add, remove, and reorder highlight clips in the app.
- Draft media written by the app opens correctly in the legacy builder.
- Published profiles render the same media after the existing publish flow runs.

## Validation

- Focused `PlayerDetail` and player-service unit tests
- `npm run app:build`
- Manual iOS and Android camera/library smoke where native device access exists
