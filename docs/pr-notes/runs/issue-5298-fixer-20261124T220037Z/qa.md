# QA Analysis

## Regression Matrix

| Evidence | Expected |
| --- | --- |
| Matching artifact SHA and deployment ID, explicit `unchanged` | Accept |
| Artifact SHA only, relabeled `unchanged` | Reject |
| Deployment ID only, relabeled `unchanged` | Reject |
| Complete unchanged evidence with either identity mismatched | Reject |
| Existing complete `updated` evidence | Accept |
| Existing single-identity `current` evidence | Accept |

Keep accepted and rejected unchanged cases adjacent and exercise the public verifier. The smallest focused validation is `npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose`.

## Recurrence Risk

Medium before regression coverage because similar-looking evidence shapes can be accidentally promoted. Exact positive and negative shape tests reduce this to low for this classifier.
