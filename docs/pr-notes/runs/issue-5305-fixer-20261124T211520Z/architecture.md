# Architecture analysis

The verifier already models current application evidence and two exact current
individual-function shapes. Add a third closed individual-function shape for
updated evidence containing both artifact and deployment identities. Route it
through a state-aware envelope validator, preserve the current branches, and
compare both identities to the expected deployment before returning a normalized
classification.

Root cause: every individual-function branch invokes a current-only envelope
validator and no exact updated-evidence schema exists, so valid explicit update
proof is unrepresentable. Keeping the new shape exact prevents status-only or
partially identified updates from becoming authoritative.

The requested architecture skill was unavailable, and the spawned architecture
lane failed before analysis because its reply runtime was missing. This artifact
records the main-run fallback synthesis.
