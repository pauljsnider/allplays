# QA Notes

## QA Plan
- Re-run the two failing team-chat fallback smoke tests locally.
- Re-run the full `test:smoke:team-fallback` suite if time allows because the same stub file backs adjacent media/replay guards.

## Expected Coverage
- Conversation listing denied: verifies fallback default conversation label and message rendering.
- Scheduled reminder fallback: verifies reminder text and ALL PLAYS sender render after realtime callback.

## Risk Focus
- Missing stub exports can stop the page module before app initialization, leaving static HTML and loading state. Assertions should prove the page reaches rendered fallback state and page errors remain empty.
