# QA

- Add/update smoke coverage for repeated Apply.
- Validate first Apply uploads once and saves stats.
- Validate second Apply with only score/mapping changes commits again but does not upload again.
- Validate `statSheetPhotoUrl` remains the originally uploaded URL.
- Validate overwrite confirmation still prevents deletes/commits when cancelled.
- Manual check: browser network/storage should show no second upload on unchanged file re-apply.
