# Architecture

Decisions:
- Keep team-media under `team-media/{teamId}/{folderId}/{userId}/{fileName}` and gate object reads with the existing team membership helper.
- Split Storage read into `get` and `list` so direct object reads work for authorized members while bucket listing stays denied.
- Add narrow legacy fallback matches for `stat-sheets/**` and `game-clips/**`, limited to signed-in users and no listing.
- Keep deletion logic in `js/db.js` where Firebase document and Storage references are built.

Risks and rollback:
- Fallback path rules preserve current behavior but still have broader blast radius than team-scoped paths. Roll back by removing those matches after all callers migrate to scoped storage.
