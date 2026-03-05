# QA Role Notes

- Thinking level: medium (contract regression prevention).
- Risk focus: consumers calling Timestamp APIs (`toDate`) on `publishedAt` after publish.
- Added guardrail: policy unit test verifies `publishBracket` keeps `publishedAt` as `Timestamp` and forbids ISO conversion.
- Validation scope:
  - static policy test for function body contract
  - existing bracket helper tests to ensure no collateral behavior changes
