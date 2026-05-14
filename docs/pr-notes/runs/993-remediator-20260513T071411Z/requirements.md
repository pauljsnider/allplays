# Requirements Notes

## Acceptance Criteria
- Opening the media gallery must not move the main chat viewport while older history is loaded to populate gallery media.
- Each prepended history batch must preserve the reader's relative scroll position by applying the scroll-height delta after render.
- Existing load-more behavior must continue to load older messages and keep the viewport stable.

## Assumptions
- Gallery history loading can continue to reuse `loadMessages(true)` for pagination and hydration.
- The modal gallery's own scroll position is independent from the main chat message viewport.
