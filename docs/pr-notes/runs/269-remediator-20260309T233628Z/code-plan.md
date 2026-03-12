Implementation plan:
1. Add a small helper in parent-membership-utils for checking whether a user profile already has a team/player parent link.
2. Use that helper in approveParentMembershipRequest before mergeApprovedParentLinkState.
3. Remove the requester denied -> pending branch from firestore.rules.
4. Extend the parent membership utility tests to cover the new existing-link helper.
