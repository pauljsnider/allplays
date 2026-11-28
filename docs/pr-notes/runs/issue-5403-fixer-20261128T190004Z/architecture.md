# Architecture Analysis

## Contract

Production success requires both a successful Firebase command and authoritative evidence for every intended Function. Exit code 0 proves process completion, not target-set completeness.

## Minimal design

Reuse the aggregate verifier introduced by dependency #5402. Add a test-only execution-result fixture with exit code 0 and a partial authoritative evidence array, then assert the verifier fails closed with the omitted Function identified.

No production workflow or verifier change is needed because the current aggregate verifier already compares expected target identities against authoritative evidence.

## Risks

- Keep at least one valid target result so the case is partial, not empty or malformed.
- Compare target identities rather than relying on counts.
- Avoid coupling to unrelated metadata formatting.
- Keep Hosting, retry persistence, smoke checks, and workflow wiring out of scope.

## Recurrence risk

Medium: parser or workflow refactors can collapse semantic verification back to process-level success.
