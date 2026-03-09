Implementation plan:
1. Add `js/team-chat-media.js` for shared media constants and pure helpers.
2. Add failing tests for normalization, gallery derivation, and updated help search text.
3. Update `js/db.js` to upload generic chat media and persist `attachments` plus legacy image fields.
4. Update `team-chat.html` to support multiple pending attachments, render image/video grids, and expose a "Photos & Videos" modal.
5. Update workflow copy in `workflow-communication.html` and `workflow-manifest.json`.
6. Run focused Vitest coverage, then the repo unit suite if no new failures appear.
