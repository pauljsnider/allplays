Objective: close the review finding on orphaned chat uploads during multi-file send failure.

Current state
- PR head `915a78425cb3316e9320302ca16da522459e6875` already replaces `Promise.all(...)` with sequential uploads in `team-chat.html`.
- The send flow now tracks uploaded attachments and calls `deleteUploadedChatAttachments(...)` if posting the chat message or a later upload fails.

Proposed state
- Keep the existing runtime fix.
- Add focused regression coverage so the partial-failure cleanup path stays reviewable and does not regress silently.

Risk surface and blast radius
- Scope is limited to the team chat composer send path in `team-chat.html`.
- Failure mode addressed: orphaned Storage objects without a corresponding chat message.
- Multi-tenant/storage impact is reduced because failed sends now attempt cleanup before surfacing the error.

Assumptions
- Cleaning up attachments created in the same send attempt is safe because they are not yet referenced by any persisted chat message.
- Static wiring coverage is acceptable in this repo for HTML-embedded logic when extracting a helper would be disproportionate to the patch size.

Recommendation
- Accept the runtime remediation already on the branch and add a focused regression test for the cleanup contract.
