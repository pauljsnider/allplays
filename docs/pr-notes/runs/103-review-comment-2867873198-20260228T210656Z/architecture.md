# Architecture Role Notes

## Decision
Keep parser architecture unchanged and tighten input validation at the numeric-offset parse boundary.

## Rationale
- Minimal safe patch in a single function avoids widening blast radius.
- Validation at parse boundary prevents malformed offsets from flowing into date math.

## Controls Equivalence
- Control model remains fail-closed (`warn` + `null`) for invalid ICS datetime inputs.
- No new data paths, storage writes, or auth behavior changes.

## Tradeoffs
- This check enforces review-requested range and does not attempt a full timezone-offset canonicalization policy.
