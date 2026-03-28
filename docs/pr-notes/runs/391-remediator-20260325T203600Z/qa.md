QA analysis
Risks: page-load crash from TDZ; RSVP submissions resolving zero scoped players due to stale schedule reference.
Manual checks: load parent dashboard without ReferenceError; submit RSVP from button after schedule hydration and verify local state updates for the matching event rows.
Repo guidance: no automated tests; use targeted manual validation reasoning for affected flow.
