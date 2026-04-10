Decision: keep the fix in the existing browser-side data access layer instead of widening scope into new APIs or refactors.

Why:
- The blast radius stays limited to athlete-profile reads and saves in `js/db.js`.
- Firestore rules remain the primary control; the new read guard is defense in depth for private profile rendering.
- The null check in the season loop is a low-cost resilience improvement that preserves behavior for valid inputs.

Risk surface:
- Read path: public profiles still render anonymously; private profiles now require ownership in code as well as rules.
- Save path: invalid selected season keys are skipped instead of throwing on `undefined`.

Rollback:
- Revert the single `js/db.js` change if it causes regressions in athlete profile load/save flows.
