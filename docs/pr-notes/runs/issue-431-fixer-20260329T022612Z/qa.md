# QA Role Synthesis

## Primary Regression Targets
- Coach can move a player between `No Response`, `Going`, `Maybe`, and `Not Going`.
- Section counts update on each click.
- Success state reaches visible `Saved` after the async save path completes.
- Stored RSVP docs resolve by latest timestamp when parent and coach writes overlap.

## Test Strategy
- Unit test a Game Day RSVP controller/helper with mocked DOM and save/load dependencies.
- Unit test pure breakdown logic with roster + stored RSVP docs representing reload state.
- Keep assertions user-visible: section labels/counts, called payloads, and visible status text.

## Residual Risk
- Full browser wiring remains indirectly covered rather than end-to-end.
- Firebase permission edge cases remain covered by existing RSVP logic and manual tests.
