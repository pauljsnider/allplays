# Requirements analysis

The requested `allplays-requirements-expert` skill was unavailable, so this analysis applies the assigned UX expert, coach, parent, and sports-manager perspectives directly.

## Acceptance mapping

- Retain the configured 390x844 touch viewport and expose a two-player chooser.
- After the team roster loads, assert the chooser is blank, **Send request** is disabled, and no request has been captured.
- Explicitly choose the second player, assert **Send request** becomes enabled, and submit.
- Assert the captured request contains the selected team ID and second player ID.

## User risk

Parents may have multiple children on the same team. A first-roster-entry default can request access for the wrong child without an intentional choice. Selecting the second fixture player makes that failure observable and protects the explicit-consent boundary.

## Scope decision

Production behavior is out of scope and already provides a blank controlled player selection. This slice should add only the missing mobile smoke regression.
