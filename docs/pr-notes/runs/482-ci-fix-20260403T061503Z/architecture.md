# Architecture Role Notes

- Skills requested by repo guidance were not available in this session, so analysis was done inline.
- Current state: PR adds a shared-game reference check inside `deleteConfig(teamId, configId)`.
- Proposed state: keep that runtime guard and align tests plus cache-bust wiring with the new `db.js` diff.
- Blast radius: limited to the edit-config deletion path, its unit assertion, and the matching smoke stub import version.
