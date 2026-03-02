# QA role (inline fallback)
- Validate that failure after user grant attempts rollback of newly-added coachOf/team and coach role.
- Validate existing success path still updates team adminEmails and access code used state atomically.
- Confirm no changes to outdated threads already fixed by atomic persistence path.
