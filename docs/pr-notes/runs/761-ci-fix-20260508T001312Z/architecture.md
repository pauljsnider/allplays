# Architecture note

Root cause: `team.html` `getAllEvents()` now calls `canManageTeamAvailability()` directly while normalizing RSVP visibility. The focused unit test extracts `getAllEvents()` into an isolated `new Function` harness, but the harness did not provide that dependency, causing a `ReferenceError` before behavior assertions ran.

Decision: keep production code unchanged. Add the missing dependency to the unit harness with a non-admin default, preserving the existing access-control behavior and limiting blast radius to the failing test fixture.
