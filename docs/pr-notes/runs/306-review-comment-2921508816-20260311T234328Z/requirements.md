# Requirements Role

- Objective: preserve successful lineup publish while giving coaches immediate, user-facing feedback if the follow-on team notification fails.
- Current state: lineup persistence succeeds, the publish button shows success, and notification failures only reach `console.warn`, which most coaches will never see.
- Proposed state: keep publish success non-blocking, but surface a clear manual follow-up action when chat notification delivery fails.
- Risk surface: UI-only change in the game-day publish flow. No schema, auth, or Firestore rule changes. Blast radius is limited to the publish-lineup interaction in `game-day.html`.
- Assumptions:
  - Publishing the lineup is the primary action and must remain committed even if chat notification fails.
  - Coaches need plain-language recovery guidance more than raw error detail.
  - Manual team outreach is an acceptable fallback when chat write fails.
- Recommendation: use a fixed alert message after successful persistence when `afterPersist` fails. This preserves the successful publish outcome and gives the coach an explicit next action.
- Success criteria:
  - lineup remains published when chat write fails
  - coach sees an alert explaining the notification failure
  - regression coverage verifies the user-facing message remains wired in
