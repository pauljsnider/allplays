# Requirements

Acceptance criteria:
- Team media Storage object reads must be limited to users with team access: owner, admin, global admin, or parent linked to the team.
- Team media Storage listing must not be exposed broadly.
- Existing main-bucket fallback upload paths used by chat, game clips, stat sheets, and drill diagrams must remain available to signed-in users.
- Deleting a team media photo must fail with a clear error before Firebase delete operations if the file reference is missing.
- Deleting a team media item must use a validated document reference before updating the Firestore record.
