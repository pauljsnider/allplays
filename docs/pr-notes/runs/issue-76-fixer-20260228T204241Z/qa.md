# QA Role Analysis

## Regression guardrails
Add deterministic unit tests for `parseICS` with:
- TZID in DST-sensitive zone (America/New_York) asserting expected UTC instant.
- Explicit numeric offset (`-0500`) asserting expected UTC instant.
- Baseline UTC `Z` parsing unchanged.

## Assertions
- Compare `toISOString()` for exact instant correctness.
- Confirm parser still returns event objects with required fields.

## Manual checks after patch
- In non-Eastern browser timezone, verify calendar card time matches expected converted local time.
- Track event and validate Firestore `date` corresponds to same instant as parsed DTSTART.
