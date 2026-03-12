# Requirements analysis

- Problem: the approval flow writes the requester profile document from the approver transaction, but Firestore rules only allow users to write their own `/users/{userId}` doc or a global admin to do so.
- Constraint: team owners/admins approving another user are not allowed to write `/users/{requesterUserId}` directly.
- Required outcome: approval must succeed for normal team owners/admins without widening permissions or changing unrelated behavior.
