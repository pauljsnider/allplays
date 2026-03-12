# QA

- Validate manual flow: attach 2+ files, force one upload failure, confirm no message is posted and prior successful uploads are removed from storage.
- Regression check: successful multi-file send still posts one message with all attachments; single-file send unchanged.
- Residual risk: cleanup is best-effort, so a storage delete permission issue would still leave an orphan; log that case without hiding the original send error.
