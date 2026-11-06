# Requirements — Issue #5157

> The requested `allplays-requirements-expert` skill was unavailable; this analysis follows the repository guidance and issue contract directly.

## Root cause

The React/Capacitor Register tool models registration only as currently published forms. It calls `loadParentRegistrations`, so a submitted application disappears from the mobile-first experience when its form closes or is unpublished. The existing legacy application-history query and UI already provide the missing family follow-through, but that contract is not exposed through the app adapter/service boundary.

## User requirements

- Show a distinct **Submitted applications** section without changing existing open-form cards or actions.
- Show player, program, team, optional selected option, and normalized read-only status.
- Support Pending Review, Waitlisted, Offer Extended, Offer Accepted, Enrolled, Released, and Rejected.
- Keep applications visible independently of whether the source form is published.
- Reuse guardian-email and submitting-user UID matching, ordering, and deduplication.
- Paginate independently; append older results without replacing loaded cards.
- Retain successful cards on retryable failures and retry from the returned retry cursor.
- Never render parent decision or status-mutation controls.

## UX and stakeholder decisions

- Separate Submitted applications from Available registrations with independent loading, empty, and error states.
- Status badges include text and do not rely on color alone.
- Omit an absent selected option instead of rendering a placeholder.
- Disable pagination/retry controls during their request while retaining visible data.
- This confirms receipt for parents, reduces coach support questions, and gives sports managers a complete mobile follow-through surface.

## Minimal scope and guardrails

Expose the existing query through the adapter, add typed application/page models and a thin authenticated service loader, add independent history rendering, and add focused regressions. Do not duplicate Firestore queries, identity matching, enrichment, sorting, deduplication, or status normalization in React. Do not change rules, indexes, or decision workflows.
