# Architecture

Subagent spawn unavailable in this run, so this is inline role analysis following the orchestrator fallback.

## Architecture Decisions
- Keep the delete fix in `js/team-media.js` at the event handler boundary. After `deleteTeamMediaItem` succeeds, mutate the module-level cache and call `render()` directly for deterministic UI consistency.
- Keep MIME fallback logic centralized in `js/team-media-utils.js` inside `isSupportedTeamMediaDocument`.
- Add extension and generic-MIME constants next to the existing document MIME whitelist.

## Blast Radius
- Delete behavior changes only for the single item delete button.
- Upload validation changes only for document/file uploads, not images or video links.

## Rollback
- Revert the handler change and utility constants/function body if needed.
