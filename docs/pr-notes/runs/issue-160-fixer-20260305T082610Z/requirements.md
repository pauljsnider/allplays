# Requirements Role (synthesized fallback)

Skill/tool note: `allplays-orchestrator-playbook` and `sessions_spawn` are unavailable in this runtime, so this analysis is produced directly in the main lane.

## Objective
Ensure team chat unread badges clear when a user has actually seen incoming messages during the same chat session.

## Current vs Proposed
- Current: last-read updates on snapshot callbacks, but there is no explicit retry when the user returns focus/visibility after transient inactive state.
- Proposed: keep snapshot updates and add active-view lifecycle retry so read-state advances once the user is actively viewing messages.

## Risk Surface / Blast Radius
- Scope limited to team chat page last-read behavior.
- No Firestore schema/rules change.
- Main risk: over-marking read when user is not actually viewing chat; mitigated by existing visibility/focus gates.

## Success Criteria
- Realtime messages viewed in chat do not remain unread on dashboard/team pages.
- No regression for hidden/unfocused tab behavior.
