Objective: cover the parent dashboard calendar-day modal flow where one parent RSVP updates multiple children on a shared game.

Current state: helper-level tests cover child scoping and controller-level tests cover grouped submissions, but no page-level test drives the aggregated calendar entry, modal button dataset, and optimistic modal refresh together.

Risk surface: parent-facing availability writes. Blast radius is limited to parent dashboard RSVP interactions, but a regression here can silently submit partial child coverage or leave stale state in the modal.

Assumptions:
- The existing Vitest HTML-module harness is the right test layer for this repo.
- The highest-value gap is the shared game day modal path, not list-row RSVP.

Recommendation: add one integration-style `parent-dashboard.html` test that opens the calendar day modal for a shared game, submits `Going` for both child IDs, and verifies both the write payload and refreshed modal state.
