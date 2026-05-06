# Admin role

Team owners and team admins can manage roster operations for their teams. Global admins retain platform-wide access through the Admin Dashboard.

## Registration form setup

Global admins can open `admin.html`, choose a team, and use **Registration forms** to create or edit season, camp, or team-program forms. Each form stores title, description, program type, season, participant fields, guardian fields, waiver text, fee display amount, and draft/published status under `teams/{teamId}/registrationForms/{formId}`.

Published forms show a copyable `registration.html?teamId=...&formId=...` URL in the admin UI. Draft forms remain editable but are not readable or submittable by parents because public registration reads and pending submission writes require a published form in Firestore rules.

## Registration review

Registration submissions are reviewed from `edit-roster.html` for the team. Admins can filter a registration form by pending, approved, rejected, or all submissions.

Approval is explicit and auditable:
- Pending submissions can be approved into a new roster player, or into an existing linked player when the registration already carries a selected player id.
- Player records are created or updated without copying sensitive medical or emergency-contact fields into the public player document.
- Guardian details are retained on the player record. If a guardian email already maps to a user account, the user profile is linked through `parentOf`, `parentTeamIds`, and `parentPlayerKeys`.
- The registration stores the reviewer, decision time, linked player id, guardian links, and roster destination.

Rejected registrations keep the submitted data and are marked `rejected` in the review queue so the decision remains visible for later audit.
