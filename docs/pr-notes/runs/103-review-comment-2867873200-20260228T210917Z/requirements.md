# Requirements Role Output

## Objective
Ensure ICS field parameter parsing correctly handles quoted and escaped parameter values so TZID extraction is standards-tolerant and does not corrupt timezone identifiers.

## Current State
`parseICSField` splits parameters on raw semicolons and strips only boundary quotes. Escaped separators (`\\;`, `\\,`) and escaped quotes (`\\"`) are not decoded, and escaped semicolons can break parameter tokenization.

## Proposed State
- Parameter splitting is quote/escape-aware.
- Parameter values decode common ICS escapes before use.
- Existing valid TZID and numeric-offset behavior remains unchanged.

## Acceptance Criteria
1. Quoted TZID with escaped comma/semicolon is decoded before timezone resolution.
2. Quoted TZID with escaped quote is decoded before timezone resolution.
3. Existing timezone parsing tests (TZID, Z-suffix, numeric offsets, DST edge warnings) continue passing.

## Risk Surface
- Blast radius limited to ICS field parameter parsing in `js/utils.js`.
- Primary regression risk: unintentionally changing behavior for non-escaped parameters.
