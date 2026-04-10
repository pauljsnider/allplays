# Code role

## Implemented patch set
- Replace Firestore `users.email` lookup with Firebase Auth `getUserByEmail` in `getUserIdsByEmails`.
- Chunk `sendEachForMulticast` requests to 500 targets and aggregate responses/counts.
- Update chat trigger guard to notify for image-only messages with fallback body `Sent a photo`.

## Conflict resolution
- Requirements and architecture aligned on minimal patch scope.
- QA requested test coverage; runtime lacks function test harness, so applied `node --check` plus explicit staged verification checklist.
