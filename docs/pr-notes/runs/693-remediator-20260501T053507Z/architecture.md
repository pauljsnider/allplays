# Architecture

Keep the existing ordered fallback schema model. Change selection semantics from "first array" to "first non-empty array" so migration placeholders do not mask populated legacy or alternate keys.

No merge is required for this remediation because the existing function is designed around a single authoritative schema source and the review feedback explicitly allows requiring a non-empty array before selecting a source.

## Risk and rollback

- Risk: If an intentionally empty higher-priority schema is meant to suppress lower-priority definitions, this change will expose fallback definitions. Given the migration bug, preserving real definitions is the safer default.
- Rollback: Revert the single function predicate and associated test.
