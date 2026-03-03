# Architecture Role Summary

## Decision
Parameterize runtime options at module scope:
- `calendarServiceAccount = functions.config()?.calendar?.service_account`
- `fetchCalendarRuntime = calendarServiceAccount ? { serviceAccount: calendarServiceAccount } : {}`
- Pass `fetchCalendarRuntime` to `runWith()`.

## Why
- Removes environment detail from source.
- Preserves explicit identity support when required.
- Keeps fallback path simple and safe using default function identity.

## Controls Equivalence
- Access control remains enforced by deployed service account / default identity.
- Configuration management moves to Firebase environment config, improving operational secrecy.
