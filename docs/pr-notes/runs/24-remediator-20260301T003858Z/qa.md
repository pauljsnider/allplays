# QA Role - PR #24 Remediator (2026-03-01T00:38:58Z)

## Regression Risks
- Curl-failure path may report incorrect exit code or skip redaction in logs.
- Notification preflight could allow placeholder credentials.
- Lock fd leak could leave stale descriptor behavior on repeated runs.

## Validation Plan
1. Static check: `bash -n scripts/nightly-playwright-smoke.sh`.
2. Regression script test for `slack_api_post` failure behavior:
   - Stub `curl` to fail and emit the token in stderr.
   - Assert script log output is redacted.
   - Assert failure log references non-empty, deterministic exit metadata.
3. Recheck no `bash -lc` remains in script execution path.

## Exit Criteria
- Validation commands return zero.
- Failure-path assertions pass without exposing secrets.
