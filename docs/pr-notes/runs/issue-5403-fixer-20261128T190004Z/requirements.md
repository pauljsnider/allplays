# Requirements Analysis

## Required behavior

An exit-zero Firebase Functions deploy is not sufficient production evidence. The gate must also prove that every expected Function has authoritative deployment evidence.

## Acceptance interpretation

The regression must combine a successful process exit with valid evidence for only a strict subset of expected Functions, then assert that verification rejects the deployment rather than reporting production success.

## Root cause

The suite covers incomplete aggregate evidence, but it does not explicitly bind that failure to the workflow's exit-zero deploy path. A future change could therefore trust Firebase CLI process success without a regression that preserves the semantic completeness gate.

## Recommendation

Add one focused test in `tests/unit/verify-firebase-application-deployment.test.js` that models exit code 0, omits one expected Function while keeping the other evidence authoritative, and asserts the existing incomplete-target error. Avoid workflow, Hosting, retry identity, and metadata-formatting changes.

## Recurrence risk

Medium: deployment CLIs expose coarse process success, so completeness must remain independently asserted.
