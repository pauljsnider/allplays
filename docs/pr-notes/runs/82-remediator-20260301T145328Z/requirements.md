# Requirements role notes
- Objective: remediate unresolved PR #82 review feedback on invite acceptance flow.
- Feedback threads require:
  - Admin invite path must persist admin email update to team document.
  - One-time admin invite redemption must be safe under concurrent requests.
- Acceptance criteria:
  - Admin invite redemption performs consume+role grant in a single transaction with used-state guard.
  - Team `adminEmails` is updated during redemption when an email is available.
  - Any affected unit tests reflect the current atomic behavior.
