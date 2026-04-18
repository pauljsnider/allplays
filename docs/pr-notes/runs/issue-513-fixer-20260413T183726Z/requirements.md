# Issue #513 Requirements Synthesis

## Acceptance Criteria
1. `help.html` loads and renders its workflow cards from the embedded manifest, with summary text reflecting visible results.
2. Role filtering and search work together at runtime, including a Coach flow that can narrow to schedule-related guidance and an empty-state flow when nothing matches.
3. Users can open a workflow from the filtered Help Center and land on a valid workflow page.
4. `help-page-reference.html` loads, shows sentinel rows including `edit-schedule.html`, `live-game.html`, and `help-page-reference.html`, and returns to `help.html` via its back link.
5. Help-advertised references do not send users to dead pages. Coverage must catch stale references such as the current `check-admin-status.html` listing.

## User Risks
- Coaches lose time on game day if help search/filter results drift.
- Parents fall back to manual support if guides are not discoverable or route to dead ends.
- Admin/support load rises when hand-maintained help references silently drift after page renames.

## Recommended Test Expectations
- Add Playwright coverage for `help.html` runtime behavior: initial render, role filter, search narrowing, combined filter behavior, summary updates, empty-state toggling, and workflow navigation.
- Add coverage for `help-page-reference.html`: sentinel rows, back navigation, and reference integrity checks for advertised help/workflow targets.

## Open Questions Resolved For This Fix
- Do not widen scope into a full help information architecture redesign.
- Treat stale page references as the concrete fix in scope for this issue.
- Keep tests focused on shipped help UX and lightweight file existence checks, not Firebase-dependent deep app boots.
