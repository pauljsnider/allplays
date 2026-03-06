# Requirements Role Output (manual fallback)

## Objective
Ensure unread badges do not count messages a user already saw while actively viewing team chat.

## User-visible defect
During an active team chat session, new incoming messages are visible in real time but still counted as unread on dashboard/team pages.

## Constraints
- Keep behavior aligned with current notification model (`createdAt > chatLastRead[teamId]`).
- Do not change badge rendering pages unless needed.
- Keep changes minimal and low-risk.

## Acceptance criteria
1. While user has team chat page open and receives new messages, chat last-read is advanced in-session.
2. Leaving chat and opening dashboard does not show false unread count for messages already seen in active session.
3. No regression to first-load behavior.
