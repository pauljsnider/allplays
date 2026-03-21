Objective: close PR #344 review thread PRRT_kwDOQe-T5850aOTz by preserving the parent rideshare re-request flow without restoring access for revoked parent-child links.

Current state:
- `firestore.rules` allows the request owner to move a `declined` or `waitlisted` rideshare request back to `pending`.
- That branch keeps immutable IDs stable but only checks `resource.data.parentUserId == request.auth.uid`.
- A stale request can therefore be reactivated even if the user no longer has live parent access to `resource.data.childId` on the team.

Required state:
- Re-request stays available only when the parent still satisfies `isParentForPlayer(teamId, resource.data.childId)`.
- Scope remains limited to the existing request-owner re-request path under `rideOffers/{offerId}/requests/{requestId}`.
- No change to create, driver decision, delete, or unrelated team access rules.

Risk surface and blast radius:
- Blast radius is limited to rideshare request updates for declined or waitlisted requests.
- Main risk is accidentally breaking the intended re-request flow for legitimate parents. Mitigation: keep the existing field-diff contract and add only the missing live-access predicate.

Assumptions:
- `users.parentPlayerKeys` is the authoritative live authorization source for parent-child access.
- Re-request should fail once the parent-player relationship is revoked, even if a stale request document still exists.
