QA role
Focus: verify visible count and filtering behavior.
Manual checks: 1) with first N games cancelled and later games active, function still yields limitCount active games when enough exist. 2) when fewer than limitCount active games exist in the 7-day window, function returns only available active games. 3) live games remain unaffected.
Risk: Firestore query/operator combination could fail if unsupported or missing index.
Validation: run any available targeted static/manual checks and inspect diff carefully since there is no automated runner.
