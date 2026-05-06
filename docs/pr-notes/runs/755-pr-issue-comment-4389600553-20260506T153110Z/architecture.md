# Architecture

Decision: make `planRosterCsvImport` patch-like for the optional core `number` field.

- Detect whether the CSV mapped a Number/Jersey column.
- Build player payloads without `number` by default.
- Add `payload.number` only when the CSV includes a mapped number column.
- Firestore update payloads then preserve existing player numbers for partial CSV imports.

Blast radius: one static JS module and one unit regression. No Firestore rules, schema migration, or backend changes.
Rollback: revert the conditional payload inclusion and regression test.
