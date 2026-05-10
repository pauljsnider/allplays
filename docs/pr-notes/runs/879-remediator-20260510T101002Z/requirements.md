# Requirements

- Address review thread PRRT_kwDOQe-T586A3JZI for `parent-dashboard.html` RSVP behavior.
- When a parent updates RSVP from a per-child modal row for one child, the saved RSVP response updates only that child's `myRsvp` state.
- The returned RSVP summary must be applied to every local schedule event for the same team/game so merged calendar/modal cards recompute from fresh totals regardless of which sibling was first in `allScheduleEvents`.
- Keep behavior scoped to local state refresh after successful save. No unrelated UI or data model changes.
