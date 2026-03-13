Objective: remediate PR #231 review feedback in edit-schedule.html only.
Current state: game/practice submit handlers treat post-save chat notification failures as full save failures; RSVP modal applies async results without checking if the request is still current.
Proposed state: persistence remains the source of truth, notification failures become non-fatal warnings after save, and RSVP reminder context/UI only update for the most recent modal request.
Risk surface: schedule save UX, notification metadata writes, RSVP reminder targeting. Blast radius limited to edit-schedule page.
Assumptions: save operations succeed before notification side effects run; no automated test suite exists; minimal targeted client-side changes are preferred.
Recommendation: isolate notification work behind local try/catch after successful save and gate RSVP async results with a monotonically increasing request token.
Success: users do not retry already-saved events because chat failed, and reminders cannot target a previously opened event after rapid modal switching.
