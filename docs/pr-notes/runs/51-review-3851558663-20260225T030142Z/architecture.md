# Architecture Role (allplays-architecture-expert)

## Objective
Apply the smallest centralized change that tightens link safety controls across all drill markdown render paths.

## Current vs Proposed Architecture
- Current: Two functions (`linkifySafeText`, `applyInlineMd`) independently regex-linkify URL-like tokens.
- Proposed: Shared URL linkifier pipeline:
  1. Detect candidates with conservative token regex.
  2. Trim terminal punctuation when it is sentence syntax.
  3. Validate with `new URL()` + protocol/hostname constraints.
  4. Emit anchor only for valid candidates.

## Controls Equivalence/Improvement
- Preserved: HTML escaping occurs before markdown linkification.
- Improved: URL structure validation blocks malformed links from being promoted to anchors.
- Segregation/auditability: No data-model or auth changes; confined to rendering helper module.

## Blast Radius
- Low and localized to `js/drills-issue28-helpers.js` consumers.
- No backend/Firebase/rules impact.

## Rollback Plan
Revert single helper-file commit if regressions are found.
