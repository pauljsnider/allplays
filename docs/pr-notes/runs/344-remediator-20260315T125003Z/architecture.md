Decision: harden the existing requester-owned re-request rule in place instead of adding a new helper or restructuring rideshare access paths.

Current state vs proposed state:
- Current state: the re-request branch verifies request ownership, immutable IDs, allowed field mutations, and open-offer state.
- Proposed state: keep that contract and add one live authorization check, `isParentForPlayer(teamId, resource.data.childId)`, before allowing `declined` or `waitlisted` back to `pending`.

Why this path:
- It closes the exact gap identified in review with the smallest code change.
- It preserves existing behavior for still-authorized parents and preserves the same blast radius.
- It avoids broadening helper usage or changing unrelated read/write semantics.

Controls:
- Access control becomes equivalent to the create path for parent-child linkage.
- Rollback is a one-line rules revert if this unexpectedly blocks valid traffic.
