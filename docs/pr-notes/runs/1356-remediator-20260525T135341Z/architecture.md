# Architecture

## Architecture Decisions
- Keep the search service contract as-is for the React app: current TypeScript results include `help`.
- Add a component-level compatibility fallback so externally mocked or JS-shimmed result payloads without `help` are treated as an empty help result list.
- Use the fallback only at render/offset/status boundaries. Do not mutate service results.

## Risk And Rollback
- Risk surface is limited to `AppSearchDialog` rendering and keyboard index offsets.
- Rollback is the single component fallback plus the shim regression update.
