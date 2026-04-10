# Requirements Role

Objective: prevent a tracked shared-calendar ICS event from continuing to render beside its DB-backed game after import.

Current state:
- `edit-schedule.html` suppresses tracked ICS imports through `trackedUids`.
- `calendar.html` applies similar logic inline, but coverage does not prove the tracked event disappears once the DB game exists.

Proposed state:
- Automated tests prove the same tracked UID is hidden on both the schedule import surface and the shared calendar surface after reload.

Risk surface and blast radius:
- User-facing duplicate events create double-tracking and RSVP confusion.
- Blast radius spans any page that shows imported ICS items beside DB events.

Assumptions:
- The repo-standard automated surface is Vitest unit tests, not the older `tests/critical` path named in the issue body.
- The intended regression is about persistent reload behavior, not the initial tracking click itself.

Recommendation:
- Add focused regression tests around the existing dedupe contract and keep implementation changes minimal.
