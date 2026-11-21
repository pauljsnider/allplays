# Requirements analysis

## Root missing behavior

Allplays normalizes timestamp highlights and loads one range at a time, but has no viewer-local playlist. The existing `timeupdate` path always pauses at one selected range and cannot advance, report progress, or stop a reel.

## User-visible contract

- Show **Watch highlight reel** only for an authorized native recorded replay with at least two playable timestamp ranges.
- Do not activate it for locked/unavailable replays, embed-only playback, attached uploads, external clips, invalid ranges, or fewer than two playable ranges.
- On the explicit tap, seek and play the first range, then advance in normalized order.
- Show the current title and position such as `Fast break · 2 of 5` in an `aria-live` status.
- Show **Stop reel** while active. Stopping pauses, clears automatic advancement, and restores ordinary replay behavior.
- Completion pauses at the final end, returns to the idle Watch action, and never loops.
- Loading any individual highlight while a reel is active cancels the reel first.
- Keep individual load/share behavior and stored highlight records unchanged.

## Playlist rules

- Preserve normalized `order`/sequence and timestamp ordering.
- Reject non-finite, negative, zero-length, reversed, or wholly out-of-duration ranges.
- Clamp to replay duration and the existing 60-second maximum.
- Exclude standalone `mediaUrl` clips and explicit different-source video URLs.
- Allow timestamp metadata without a separate URL, or an explicit URL matching the active replay source.

## Scope and risks

The slice is client-only: one pure helper, viewer-local controls/state, and focused tests. It must not stitch media, persist reel state, bypass replay entitlement, expose provider URLs, or broaden the React/backend scope.
