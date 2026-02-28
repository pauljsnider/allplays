# Requirements Role Notes

## Objective
Prevent silent timestamp corruption when ICS `TZID` conversion cannot be resolved.

## User-facing requirement
If a `DTSTART/DTEND` includes `TZID` but timezone conversion fails (invalid timezone or malformed `TZID` token), the event date must be rejected and a warning emitted.

## Acceptance criteria
- `parseICSDate` does not fall back to local browser time when `TZID` is present but unusable.
- Parser returns `null` for the invalid datetime and event is excluded by existing `parseICS` guards.
- Warning log clearly indicates the malformed/invalid `TZID` source.
