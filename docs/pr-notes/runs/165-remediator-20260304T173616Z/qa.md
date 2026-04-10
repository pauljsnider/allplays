# QA Analysis
- Regression to verify: duplicated invite code where first matching doc is used and later one unused should redeem successfully.
- Negative checks:
  - No parent_invite docs for code -> still `Invalid or used code`.
  - Only used/expired parent_invite docs -> still fail.
- Validation in this run: syntax check of modified file via Node parser; repository has no automated tests.
