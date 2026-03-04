# Requirements role synthesis (fallback)

## Objective
Restore parent dashboard rideshare actions (offer ride, request spot, confirm/decline/cancel) by ensuring script initialization completes without runtime reference errors.

## User-visible acceptance criteria
- Parent dashboard loads without JavaScript initialization errors.
- Rideshare buttons invoke callable handlers from `window`.
- Existing RSVP behavior remains unchanged.

## Constraints
- Keep patch minimal and localized to `parent-dashboard.html`.
- Preserve current UI copy and event card behavior.

## Risks
- Any broader script reshuffling could regress unrelated dashboard flows.
- Inline handler names are a contract with rendered HTML; renames would break clicks.
