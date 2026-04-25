# Architecture

## Current State
`edit-schedule.html` imports `js/db.js?v=20`. This branch added an import from `./organization-shared-schedule.js?v=1`, but that file is absent from the repo. In a browser module graph, one missing import prevents `db.js` from evaluating and breaks pages that depend on it.

## Proposed State
Remove the stray import and the three unused organization-shared-schedule helpers from `js/db.js`, while keeping the intended tournament advancement batch patch helper.

## Blast Radius
- Affected file: `js/db.js`
- Protected areas: tournament advancement UI, tournament helper logic, tests, and schedule rendering consumers
- Reduced risk: removes dead code that would otherwise break every browser page importing `db.js`

## Controls / Equivalence
- No schema changes
- No Firebase rule changes
- No write-path behavior changes for the intended PR scope
- Rollback is a single-file revert if needed

## Recommendation
Prefer reverting the incomplete organization-shared-schedule work over inventing a new module on this PR. It is the smallest change that restores module integrity and preserves the actual feature under review.
