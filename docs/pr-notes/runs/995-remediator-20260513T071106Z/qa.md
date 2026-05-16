# QA Plan

Subagent spawn unavailable in this run, so this is inline role analysis following the orchestrator fallback.

## Manual Checks
- Delete one visible media item and verify it disappears immediately after confirmation and successful delete.
- Verify a selected deleted item no longer contributes to bulk selection state.
- Validate `isSupportedTeamMediaDocument` behavior for:
  - `report.docx` with empty MIME: accepted.
  - `roster.csv` with `application/octet-stream`: accepted.
  - `notes.txt` with empty MIME: accepted.
  - `script.exe` with empty MIME: rejected.
  - `image.png` with empty MIME: rejected by document validation.
  - `.docx` with explicit unsupported non-generic MIME like `image/png`: rejected.

## Automation
- No automated test runner is defined by AGENTS.md/CLAUDE.md. Use syntax/static checks where practical.
