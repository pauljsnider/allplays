Objective: add regression coverage for edit-schedule cancel-game partial success and keep user-facing cancellation state truthful.

Current state:
- Cancel flow already separates Firestore cancellation from team chat notification failure.
- Coverage does not prove the refreshed row renders as cancelled.
- Partial chat failure still records schedule notification metadata as sent.

Proposed state:
- Keep cancellation successful when chat posting fails.
- Record notification metadata as unsent when chat posting fails.
- Cover the cancelled row UI state in unit tests.

Risk surface and blast radius:
- Limited to edit-schedule cancel-game flow.
- No schema changes; only notification metadata values and schedule rendering assertions.

Assumptions:
- Existing unit-test harness is the repo-standard automation for this area.
- A cancelled game should not show team-chat notification metadata as sent if chat posting failed.

Recommendation:
- Ship a targeted fix plus unit coverage for both partial failure handling and cancelled-row rendering.
