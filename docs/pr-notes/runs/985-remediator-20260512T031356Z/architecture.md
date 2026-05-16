# Architecture

## Decision
Add immediate validation inside `addOrUpdateStatDefinitionLine()` in `edit-config.html`, directly after reading the stat helper control values and before building/appending the definition line.

## Blast Radius
Scoped to the manager-facing stat definition helper only. The existing save-time validation in `validateStatDefinitionsForPublicLeaderboards()` remains unchanged to protect manually edited textarea content.
