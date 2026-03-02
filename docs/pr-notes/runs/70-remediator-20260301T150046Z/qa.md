# QA role notes

Validation target:
- `tests/unit/accept-invite-flow.test.js`

Expected assertions relevant to feedback:
- Team update invoked with appended `adminEmails` before profile update path.
- `coachOf` merged with prior teams (no overwrite).
- Existing admin email path avoids redundant team write.
