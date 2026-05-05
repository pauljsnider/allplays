# Code Plan

Implement the minimal test-harness fix by adding missing db stub exports used by `edit-roster.html`: `listTeamRegistrationForms`, `listTeamRegistrationReviews`, `approveTeamRegistration`, and `rejectTeamRegistration`.

No product behavior change is required. The failing assertions were downstream symptoms of the page module failing to initialize under the smoke test mock.
