Objective: remediate unresolved PR #244 review feedback with the smallest code change that closes the security and null-handling gaps.

Current state:
- `getAthleteProfile(profileId)` returned any fetched document directly.
- `saveAthleteProfile(...)` filtered selected keys up front, but the loop still assumed every selected key resolved to a valid link.
- `js/athlete-profile-utils.js` already guards zero-game averages.
- `firestore.rules` already require `request.resource.data.parentUserId == request.auth.uid` on athlete profile create.

Proposed state:
- Add explicit client-side authorization before returning private athlete profile data.
- Add a defensive null check in the season-summary loop and skip stale keys safely.
- Leave already-remediated division and Firestore rule logic unchanged.

Assumptions:
- Public athlete profiles must remain readable without authentication.
- Builder/edit flows already require auth and should continue to resolve owner profiles through `auth.currentUser`.

Success criteria:
- Private profiles no longer return data unless owned by the signed-in parent.
- Stale season keys do not throw during profile save.
- Relevant athlete-profile tests pass.
