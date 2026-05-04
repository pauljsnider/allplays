# Architecture Notes

Root cause: PR #714 added sponsor CRUD imports to edit-schedule.html, but the Playwright smoke DB module stubs do not export getSponsors, addSponsor, updateSponsor, or deleteSponsor. ES module instantiation fails before edit schedule initialization, so schedule rendering and submit listeners never attach.

Decision: update the smoke DB stubs with minimal sponsor no-op exports matching the production module contract. This keeps the patch scoped to fixture drift and avoids unrelated source changes.

Risk/rollback: no production data model change. Roll back by reverting the stub additions if needed.
