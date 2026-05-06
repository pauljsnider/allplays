# QA Plan

Automated checks:

- Regression: existing matched player with number `3`, CSV `Name,Grade`, update payload must not include `number` and grade still updates.
- Existing coverage: CSV with `Number` header still updates number to the provided value.
- Existing coverage: admin-only fields still split into private roster fields.

Manual impacted workflows:

- Coach/admin imports profile-only CSV for an existing roster member. Expected: profile changes apply and jersey number remains unchanged.
- Coach/admin imports CSV with Number column. Expected: jersey number updates intentionally.
- Coach/admin imports new player without Number column. Expected: player is created without a jersey number.
