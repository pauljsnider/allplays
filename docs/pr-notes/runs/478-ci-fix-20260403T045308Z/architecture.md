Objective: fix the preview smoke failure in cancelled imported schedule rendering with the smallest blast radius.

Current state: `edit-schedule.html` hides every practice event when `Show Practices` is off, including cancelled imported practices.
Proposed state: keep cancelled imported practices visible in the schedule list while preserving the existing default of hiding active practices until the toggle is enabled.

Risk surface: only the `edit-schedule.html` schedule filtering path. No data model, backend, or routing changes.
Assumptions: cancelled practices should remain visible as cancellation notices even when standard practices are hidden by default.

Recommendation: adjust the practice visibility predicate to exempt cancelled practices, and align the hidden-practice notice count with what is actually hidden.
