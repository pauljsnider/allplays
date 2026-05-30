# Requirements

- Public app registration links must load published registration forms for anonymous users using only the registration form document.
- The public flow must not require reading `teams/{teamId}` because non-public teams deny anonymous team document reads.
- Unpublished, closed, archived, or missing forms must remain unavailable.
- Authenticated linked-family registration detail behavior is unchanged.
