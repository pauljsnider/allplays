# Architecture

- Use the signed-in user's profile parent links to build scoped fee-recipient queries by team and player.
- Constrain direct user-id recipient lookups by linked team when links exist, and add player-specific queries for roster-generated records.
- Deduplicate snapshots into a single map keyed by document path before normalizing TeamFee records.
