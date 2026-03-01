# Architecture role notes

## Current state
- Script already has redaction and direct argv execution.
- Script acquires flock lock on fd 9 and has an EXIT trap.

## Proposed state
- Harden secret redaction coverage to include common placeholder variants and webhook URL token-bearing patterns in logs.
- Keep command execution as direct argv with explicit empty-command guard.
- Preserve lock semantics and EXIT cleanup.

## Risk / blast radius
- Low risk: shell script-only changes, no app runtime behavior change.
- Main risk is false-positive placeholder rejection; mitigate by matching only obvious placeholder patterns.
