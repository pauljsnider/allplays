# Architecture

- Parent Tools pay gating should align with backend checkout eligibility: exclude terminal statuses only (`paid`, `canceled`, `cancelled`) and require positive remaining balance.
- Keep the status eligibility rule centralized in `isParentTeamFeePayActionAllowed` so checkout URL and create-checkout paths do not drift.
- No data model changes are required; this is a client-side eligibility correction for migrated/legacy records.
