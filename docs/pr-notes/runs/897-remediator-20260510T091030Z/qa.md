# QA notes

Manual checks:
1. Recorded replay active, highlight with finite `startMs`/`endMs`: media-hub Play is visible and seeks the replay.
2. Attached scored-play clip active via saved highlight loader while a recorded replay exists: media-hub timestamp highlights show Replay unavailable and do not seek the attached clip.
3. Direct highlight `videoUrl` still produces a safe copyable URL where applicable.

Automated gate: no repo test runner exists per AGENTS.md/CLAUDE.md; use syntax check or targeted inspection for changed JavaScript.
