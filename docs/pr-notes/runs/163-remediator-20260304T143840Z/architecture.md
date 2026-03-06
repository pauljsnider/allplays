# Architecture Role Notes

- Skill/session orchestration requested but unavailable in this environment (`allplays-orchestrator-playbook` and `sessions_spawn` not present), so using inline role analysis fallback.
- Design change: initialize `generated` with occurrences already consumed before the fast-forward cursor and continue incrementing on each recurrence match.
- Keep existing recurrence pattern computation (`weekly`, `daily`, `interval`, `byDays`) intact to avoid widening blast radius.
- Blast radius: isolated to `expandRecurrence` in `js/utils.js`; no schema/API or cross-module contract changes.
- Risk: minor behavior adjustment for count+exDates interactions; acceptable for correctness of count exhaustion bug.
