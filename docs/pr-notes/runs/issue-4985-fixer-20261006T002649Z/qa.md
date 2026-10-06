# QA Strategy — Issue #4985

## Regression Matrix

| Contract | Coverage | Oracle |
| --- | --- | --- |
| One transaction reserves a range | Unit test counts 1, representative interior, and 20 | One `runTransaction` call; exact sequential array; counter advances by count |
| Invalid counts fail early | Table for 0, negative, fractional, >20, and non-number | Rejection before any transaction or counter mutation |
| Concurrent ranges do not overlap | Concurrent differently sized reservations on shared mocked state | Each range contiguous, flattened values unique, final counter equals total |
| Single item remains supported | Primitive count 1 plus existing upload/link paths | Scalar persisted order and one transaction per single item |
| Failed items leave safe gaps | Discard one value from a reserved range, then reserve again | Later range starts after the full prior range; successful values stay unique |
| Delegated rules are bounded | Emulator matrix for deltas 1–20 and invalid update classes | `assertSucceeds`/`assertFails` against a non-manager uploader |

## Rules Fixture

Seed with rules disabled: a non-owner delegated uploader profile, one team-visible folder with an integer counter, and one private folder. Use the delegated uploader context so manager authority cannot bypass the helper under test. Use `serverTimestamp()` for allowed updates.

Allow every integer delta from 1 through 20. Reject zero, negative, fractional, 21, private-folder, unrelated-field, missing-grant, and invalid timestamp updates. Verify denied writes leave seeded data unchanged where useful.

## Focused Validation

```bash
npx vitest run tests/unit/team-media-db-ordering.test.js tests/unit/team-media-rules.test.js tests/unit/team-media-wiring.test.js --reporter=verbose
firebase emulators:exec --only firestore --project demo-allplays "vitest run tests/unit/team-media-rules.test.js --reporter=verbose --no-file-parallelism"
npm run ci:firebase-rules
node scripts/check-critical-cache-bust.mjs
```

Add `tests/unit/team-media-rules.test.js` to the rules-emulator CI command so executable authorization coverage cannot silently remain skipped.

## Recurrence Risk

Medium: counter allocation, client validation, and rules authorization are separate layers. Paired unit/emulator tests plus cache-bust validation are the durable guardrails.
