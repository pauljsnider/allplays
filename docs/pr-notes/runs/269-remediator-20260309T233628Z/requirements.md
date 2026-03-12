Objective: remediate the two unresolved PR #269 review findings without changing unrelated behavior.

Current state: membership request rules allow a requester to rewrite a denied request back to pending, and approval logic does not explicitly reject requests when the requester already has a matching parentOf link.
Proposed state: only team owner/admin can decide request status, and approval fails fast if the requester already has that team/player parent link.

Risk surface and blast radius: Firestore rules affect parent membership request authorization across all teams; approval logic affects the parent access workflow for team staff. The blast radius is limited to membership request handling.

Assumptions:
- The reviewer intent is to forbid requester-driven resubmission of denied requests entirely.
- A matching users/{uid}.parentOf entry is the source-of-truth signal that access already exists for the requested player.

Recommendation: make the smallest change that removes the unauthorized status transition and blocks duplicate approval against existing parent links.
