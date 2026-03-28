Requirements analysis
Objective: fix the two RSVP regressions called out in PR review with the minimum scoped change.
Findings: parent-dashboard.html exports submitGameRsvpFromButton to window before the destructured const is initialized, which throws during module evaluation. The RSVP controller is also created with the initial empty allScheduleEvents array and later code replaces that array binding, so controller methods read stale schedule data.
Decision: move the window assignment until after controller creation and pass a getter so controller reads the current schedule array.
