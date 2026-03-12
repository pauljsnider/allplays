# Requirements

- Objective: prevent orphaned chat uploads when a multi-file send fails partway through.
- Current state: team chat uploads attachments with Promise.all and only posts the chat message afterward, so earlier successful uploads can remain in storage if a later upload rejects.
- Proposed state: on upload/send failure, best-effort delete any already-uploaded attachments before surfacing the send error.
- Risk surface: team chat attachment sending in team-chat.html and storage helper behavior in js/db.js.
- Assumptions: attachment payloads always include storage path; frontend has permission to delete files it just uploaded; cleanup failure should not mask the original send failure.
