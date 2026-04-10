Test strategy:
- Add Vitest coverage for attachment normalization and gallery indexing in a pure helper module.
- Add coverage for help content so the user-facing workflow text stays aligned with the feature.

Core scenarios:
- Normalize mixed image/video attachments and derive legacy image fields from the first image.
- Reject unsupported media types and files above the size limit.
- Aggregate gallery entries across messages in newest-first order while skipping deleted messages and unsafe URLs.
- Verify help text now advertises multiple photos/videos rather than one image.

Manual spot checks after automated tests:
- Select multiple photos/videos in `team-chat.html`.
- Remove a pending attachment and confirm send-state updates.
- Open the media modal and confirm images and videos launch correctly.

Regression guardrails:
- Existing single-image messages render through the normalized attachment path.
- Text-only messages still send with no media.
