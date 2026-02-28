# Requirements Role Summary

## Objective
Address PR #103 review comment `r2867873191` regarding timezone offset sign handling with minimal blast radius.

## User-visible outcome
- ICS imports must convert datetime values with numeric offsets and TZID offsets into correct UTC instants.
- No regression for existing `Z` UTC and DST guard behavior.

## Constraints
- Keep parsing behavior backward compatible for valid feeds.
- Prefer smallest safe change over parser rewrites.
- Preserve auditability by adding deterministic test coverage for sign convention.

## Acceptance Criteria
- `GMT+N` style offsets are interpreted as local time ahead of UTC.
- `DTSTART:...+0500` converts to UTC by subtracting 5 hours.
- Existing TZID and fallback tests remain green.
