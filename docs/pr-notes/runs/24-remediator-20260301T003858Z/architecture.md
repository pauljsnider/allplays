# Architecture Role - PR #24 Remediator (2026-03-01T00:38:58Z)

## Risk Surface
- Script runs unattended with secrets in env; logging/notification failures are high-risk for accidental token disclosure.
- Blast radius is automation observability and secret hygiene, not product runtime.

## Design Decision
- Keep existing API call flow and redaction helper.
- Replace `if ! resp="$(curl ...)"; then curl_exit=$?` with explicit status capture pattern:
  - Temporarily disable `set -e`
  - Run curl and capture `curl_exit` immediately
  - Re-enable `set -e`
  - Branch on `curl_exit != 0`

## Why
- Eliminates ambiguity from `!` + command substitution status handling.
- Preserves shell portability and minimal diff footprint.
- Keeps token redaction centralized in `redact_sensitive`.
