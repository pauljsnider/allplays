# Architecture analysis

The requested `allplays-architecture-expert` skill was unavailable, and the
required role subagent failed with `published reply runtime missing for main`.
This fallback analysis applies the requested senior Firebase architecture role.

## Root cause

`verifyFunctionDeployments` currently proves that every intended target has an
evidence entry, but it delegates each entry to the individual verifier, which
also accepts `current` artifact-only or deployment-only identity evidence.
Consequently, aggregate validation can mistake non-terminal identity evidence
for completion. Missing targets throw only a formatted message and do not carry
machine-readable, deliberately minimized metadata.

## Minimal change

- Classify aggregate entries as complete only when their status is `updated` or
  `unchanged` before individual evidence validation.
- Collect missing and non-terminal intended target names in deterministic
  intended-target order.
- Throw the existing error prefix with a stable error code and frozen metadata
  whose sole field is `incompleteTargets`.
- Keep individual target verification backward compatible because identity-only
  `current` evidence remains useful outside aggregate completion validation.

The metadata boundary intentionally excludes project ID, artifact SHA,
deployment ID, evidence bodies, quota messages, and credentials.
