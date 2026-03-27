# Requirements synthesis

## Objective
Add first-class per-item `Share`, `Save`, and `Copy link` actions to the existing team chat `Photos & Videos` gallery without changing chat authorization scope.

## Current state
- Team chat supports image/video attachments and a thread-level gallery.
- Gallery supports browsing and opening raw asset URLs only.
- No explicit affordance exists for saving media, invoking native share sheets, or copying a link.

## Proposed state
- Each gallery item exposes clear media actions:
  - `Share` uses the Web Share API when available and falls back safely.
  - `Save` downloads the selected media to the device.
  - `Copy link` copies the media URL.
- Existing media browsing remains intact.

## UX constraints
- Keep the interaction lightweight on mobile and desktop.
- Preserve existing gallery layout and thread access controls.
- Do not require backend changes or new auth scope.

## Assumptions
- Existing Firebase download URLs are the correct shareable artifact for the current authorization model.
- Web Share support is optional and must degrade gracefully.
- A link-copy fallback is acceptable when file-based share is not available.

## Success criteria
- A user can open `Photos & Videos`, choose a media item, and explicitly share, save, or copy its link.
- Unsupported browsers still provide `Save` and `Copy link`.
- The implementation is covered by unit tests for helper behavior and wiring tests for the page.
