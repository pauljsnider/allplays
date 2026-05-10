# Code Plan

Implementation plan:
- Update `storage.rules` to deny listing team media, allow authorized object gets, and restore signed-in access for known fallback prefixes.
- Update `deleteTeamMediaItem` to validate required file/doc references before deletion work.
- Run available unit tests and commit only scoped files.
