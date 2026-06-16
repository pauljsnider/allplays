# Issue 2316 Requirements

## Acceptance Criteria
- Team Settings and Team Certificates use the shared async operation hook for their primary page load.
- Both pages show one clear blocking loading state during initial fetch.
- Both pages show a page-specific initial-load failure state with an in-page Retry action.
- Retry clears the prior blocking error and restores the normal page experience on success.
- Existing staff-only and non-staff access behavior stays intact.
- Existing success behavior stays intact: Team Settings returns to team detail after save, and certificate drafts still hand off to the website flow.

## User-facing expectations
- Coaches and staff should see predictable loading, error, and retry behavior across both routes.
- Initial load failures must not leave editable controls visible in a misleading state.
- Local draft/form state should not be wiped by unrelated UI actions like choosing a photo preview.

## Out of scope
- Profile, Team Media, or Schedule Event Detail migrations.
- Service-layer cache redesign.
- New server-state library adoption.
- Authorization or parent-facing certificate visibility changes.

## Risks and ambiguities
- Keep client-side validation separate from async failure messaging.
- Preserve non-staff blocked UI semantics.
- If the website handoff fails after draft creation, do not misreport the underlying draft-save result.