# QA Analysis — Issue #5299

The requested `allplays-qa-expert` skill was unavailable, so this artifact records the equivalent QA review.

## Regression matrix

| Intended set | Evidence | Expected |
| --- | --- | --- |
| current + updated + unchanged | all matching authoritative shapes | accept all targets |
| current + unsupported + unchanged | one target has `partial` or malformed evidence | reject the aggregate |
| current + missing + unchanged | one intended target has no evidence | reject the aggregate |
| complete set in a different order | identities all match | accept and return intended order |
| duplicate evidence for one target | another target is absent or evidence is ambiguous | reject the aggregate |

The acceptance-critical regression is the mixed set where two targets are valid and one has no supported authoritative state. Validation must throw for the whole aggregate and never return partial success.

## Focused validation

```bash
npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose
```
