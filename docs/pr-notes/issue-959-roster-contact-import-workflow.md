# Issue #959: Roster Contact Import Workflow

Draft PR anchor for #959.

## Current Finding

Generic roster CSV import is limited to player identity, jersey number, and
configured roster fields. Family/contact columns, invite generation, invite
status, and contact conflict review are not first-class import targets.

## Implementation Scope

- Add an import template or mapping layer for player, guardian/contact,
  non-player, email, phone, birthday, address, position, and relationship
  columns.
- Extend CSV planning so known contact headers are parsed instead of rejected as
  unknown fields.
- Add duplicate and contact-conflict validation before any writes.
- Add player/contact write support that reuses the same linked-contact shape as
  registration approval.
- Add bulk invite generation/resend/status UI after contact writes are safe.

## Acceptance

- A roster CSV with family/contact columns can be previewed without unknown
  header failures.
- The preview reports duplicate players and contact conflicts before writes.
- Imported contacts are linked to the correct players using the existing parent
  access shape.
- Admins can send or resend invites for imported contacts in bulk.

## Validation

- `planRosterCsvImport` unit coverage for contact columns and conflicts
- Regression coverage for existing Name/Number/custom-field imports
- Legacy roster page smoke for preview and import controls
