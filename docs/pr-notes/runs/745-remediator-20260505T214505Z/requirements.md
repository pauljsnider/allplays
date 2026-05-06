# Requirements

## Acceptance Criteria
- Media hub highlight links must not render `href` values for unsafe URL schemes such as `javascript:` or `data:`.
- Valid HTTP, HTTPS, and same-origin relative highlight URLs continue to render and copy normally.
- Unsafe highlight URLs fall back to the existing `No link` UI and cannot be copied through the highlight copy action.

## Notes
- Role subagents were unavailable in this runtime, so requirements analysis was completed inline.
