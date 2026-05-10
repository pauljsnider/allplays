# Requirements notes

- Acceptance criteria: media-hub highlight Play is enabled only when the active recorded video source is the actual recorded replay source.
- If the active recorded source is an attached scored-play clip (`clip.mediaUrl`), timestamp-based replay highlights must show unavailable and must not seek within the attached clip.
- Existing copy/share behavior for direct clip URLs should remain intact; changes must be scoped to replay-seek eligibility.
