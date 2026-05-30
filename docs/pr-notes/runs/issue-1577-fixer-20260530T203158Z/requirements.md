# Requirements

## Acceptance Criteria
- Help section includes a compact role filter with exactly: All, Parent, Coach, Admin, Member.
- All is selected by default.
- Selecting a role updates local selectedHelpRole state only and visibly updates the selected chip.
- Control is usable on mobile without crowding the search input.
- Existing non-Help sections are not affected.
- Backend search, Firestore, ranking, and help result building remain out of scope.

## UX Guidance
- Place the control near the Help section, not in the main search input row.
- Use wrap-friendly chips with clear selected state and accessible pressed state.
- Keep keyboard and screen reader support via buttons in a labelled group.

## Risks
- Role control could imply filtering before the backend/search slice exists. This implementation deliberately limits behavior to local state/highlight.
- Mobile layout can crowd if chips are placed beside the main input. Chips should wrap under/next to the Help heading only.
