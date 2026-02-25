# QA Role Notes (Parent Take-Home Packet Visibility)

## Test Objective
Validate that packet CTA visibility is robust across schedule render paths and safe in fallback mode.

## Automated Validation
- `./node_modules/.bin/vitest run tests/unit/parent-dashboard-packets.test.js`
- `./node_modules/.bin/vitest run tests/unit`
- `node --check js/parent-dashboard-packets.js`
- `node --check` on extracted module from `parent-dashboard.html`

## Added Coverage
- fallback resolves packet context by same-team + same-day nearest session
- fallback does not cross team boundaries
- existing direct and recurring resolution behaviors remain covered

## Manual Verification Checklist
1. Parent Dashboard -> Schedule list: practice with packet shows `Open Packet`.
2. Parent Dashboard -> Calendar -> day modal: same practice shows `Open Packet`.
3. Click `Open Packet`: side modal loads expected packet blocks.
4. Practice without packet: no packet CTA appears.
5. Multi-team parent account: packet CTA never leaks across teams.

## Residual Risk
- If multiple same-team practices occur on the same day at similar times with missing linkage, nearest-time fallback may pick the wrong session.
- This is bounded and still safer than current hidden-CTA behavior.
