# Architecture analysis

PR #694 adds reusable roster profile field helpers, loads definitions from teams/{teamId}/rosterFields with fallback to legacy team-level arrays, and stores values under players/{playerId}.profile.customFields. Amazon Q left no blocking architecture feedback.

Risk: profile.customFields is on the public player document, so configured fields must be treated as non-sensitive roster metadata unless a later privacy model stores sensitive values under private profile paths.

Code changes required from review feedback: no.
