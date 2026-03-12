# Architecture

- Minimal change: keep per-file upload API, add a storage cleanup helper in js/db.js that deletes by recorded path from the same bucket family used for upload.
- Send flow change: upload sequentially while tracking successes, and if any later upload or post fails, call cleanup helper on the successfully uploaded attachments before rethrowing.
- Blast radius: limited to team chat multi-attachment send path; single-file and existing message rendering remain unchanged.
