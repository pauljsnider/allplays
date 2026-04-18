Current-State Read
- `track.html` already lowercases configured column names and reads player stats through a lowercase lookup map, which addresses the original case-sensitivity defect.
- `track.html` already splits aggregated-stats writes into secondary batches, reducing risk of Firestore's 500-write limit.
- The current finish flow commits secondary aggregated-stats batches before the primary game completion batch, which leaves core completion persistence later than necessary.

Proposed Design
- Extract the stat-normalization logic into a small helper in `track.html` so the case-insensitive behavior is explicit and reusable.
- Reuse the same normalization helper shape in the regression test file.
- Commit the primary batch first, then commit chunked aggregated-stats batches, preserving core completion data before secondary writes.

Files And Modules Touched
- `track.html`
- `test-track-zero-stat-player-history.js`
- `docs/pr-notes/runs/557-remediator-20260414T204502Z/*`

Data/State Impacts
- No schema changes.
- Aggregated stat documents keep lowercase configured keys plus any preserved non-config keys.
- Finish ordering changes only write sequence, not document shape.

Security/Permissions Impacts
- None. Existing Firestore paths and auth expectations stay unchanged.

Failure Modes And Mitigations
- Mixed-case historical stat keys could regress: mitigated by explicit helper and regression test.
- Large finish flows could overflow a batch: mitigated by keeping primary batch bounded and chunking aggregated writes.
- Partial failure after primary commit could still leave missing aggregated stats: accepted tradeoff because persisted game completion data is more important than secondary rollups, and this matches the reviewer concern about preserving completion data.