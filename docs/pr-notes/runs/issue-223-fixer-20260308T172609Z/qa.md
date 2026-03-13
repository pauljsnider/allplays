# QA role

- Primary regression risks:
  - Parent dashboard player cards lose existing navigation.
  - Rules accidentally expose non-public athlete profiles.
  - Career totals miscount games or average math.
- Test strategy:
  - Unit-test pure aggregation and share URL helpers.
  - Static wiring test for parent dashboard link, builder page fields, public page share action, and rules stanza.
  - Run the focused new tests plus the full unit suite if feasible.
- Manual spot checks after save:
  - Create profile from a linked player.
  - Toggle privacy to public and open share page in a logged-out browser.
  - Toggle privacy back to private and confirm public read is blocked by rules after deployment.
