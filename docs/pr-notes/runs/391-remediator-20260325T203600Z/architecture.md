Architecture analysis
Current state: parent-dashboard.html constructs the RSVP controller once and later reassigns allScheduleEvents after init loads schedule data.
Proposed state: keep the controller singleton but inject a schedule accessor function; defer the window export until the controller functions exist.
Blast radius: limited to parent dashboard RSVP initialization and submission flow; no data model or API surface changes beyond controller dependency shape.
