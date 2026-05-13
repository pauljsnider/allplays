# QA Notes

## Manual Validation Plan
1. In team chat with 50+ messages and older media, scroll to a mid-history position, open the media gallery, and confirm the main messages viewport stays at the same reading context while gallery history loads.
2. Scroll near the top and click Load older messages. Confirm older messages prepend and the viewport remains stable.
3. Open media gallery in a chat with no additional history. Confirm the gallery opens and summary renders without scroll movement or errors.

## Regression Focus
- Main message viewport scroll preservation.
- Media gallery completeness after loading all history.
- Load-more button behavior and enabled/disabled state.
