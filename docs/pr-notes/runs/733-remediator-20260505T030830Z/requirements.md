# Requirements

## Acceptance Criteria
- Save-time officiating conflict warnings must ignore cancelled games from the existing games cache.
- Cancelled or canceled status values must not produce false conflict confirmation prompts.
- A cancelled candidate game should not produce officiating conflict warnings.
- Active overlapping and back-to-back conflicts must continue to warn.

## Edge Cases
- Editing the same game remains ignored by id.
- Declined, cannot-make, and open officiating slots remain non-conflicting.
- Missing dates continue to skip conflict evaluation.
