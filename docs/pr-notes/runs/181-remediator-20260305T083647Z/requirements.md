# Requirements role (inline fallback)

- Objective: Prevent `chatLastRead` from advancing on focus/visibility return until a post-resume realtime snapshot confirms message state is current.
- Constraint: Keep unread badge correctness when browser was background-throttled or offline and reconnecting.
- Required behavior: Resume-triggered retry must be gated by a "snapshot fresh after resume" signal, not only `messages.length > 0`.
- Scope: Minimal targeted change in team chat last-read lifecycle and related unit tests.
