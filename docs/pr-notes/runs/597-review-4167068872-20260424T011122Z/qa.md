# QA

## Risk Assessment
Primary risk is incorrect final rankings caused by cross-pool override collisions. Secondary risk is regressing existing single-pool override behavior.

## Validation Matrix
- Key uniqueness for colliding legacy slugs.
- Standings rendering uses the correct override for each distinct pool.
- Legacy override records remain readable by exact `poolName`.
- Existing edit-schedule tournament wiring remains intact.

## Manual Checks
- Create two tournament pools whose names would previously slugify to the same value.
- Save different final orders for both pools.
- Reload edit schedule and confirm each pool shows its own final ranking.
- Clear one pool override and confirm the other pool remains unchanged.