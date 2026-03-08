# Requirements role

- Objective: let a parent build one durable athlete profile from linked player seasons, edit bio fields, attach highlight clips, and share a web link without exposing team admin data.
- Current state: parent flows are team-scoped; player editing only covers photo and private safety fields.
- Proposed state: add a parent-owned athlete profile record with selected seasons, computed career summary, clip metadata, and public/private sharing control.
- Risk surface: public sharing can widen blast radius if private player/team data leaks; keep the new document on a separate collection and only persist derived public-safe fields.
- Assumptions:
  - Linked `parentOf` entries are the source of truth for seasons a parent can include.
  - Existing aggregated game stats are sufficient for a first-pass career summary.
  - External clip URLs are acceptable for the first safe implementation.
- Recommendation: ship a dedicated builder page linked from the parent dashboard, plus a read-only share page.
- Success measures:
  - Parent can save a profile tied to linked seasons.
  - Career totals render from selected seasons.
  - Public profile loads without authentication when privacy is `public`.
