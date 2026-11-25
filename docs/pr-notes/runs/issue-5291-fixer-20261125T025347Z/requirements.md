# Requirements analysis

The requested `allplays-requirements-expert` skill was unavailable, and the
required role subagent failed with `published reply runtime missing for main`.
This fallback analysis applies the requested UX, coaching, parent, and sports
manager perspectives.

- A successful Firebase CLI exit is not sufficient evidence that every intended
  function was deployed; quota pressure can leave a subset unfinished.
- Aggregate validation must require terminal target evidence (`updated` or
  `unchanged`) for every intended function. Pre/post identity evidence marked
  `current` proves identity, not completion of this deployment attempt.
- An incomplete deployment must fail closed and identify every incomplete
  function target so an operator can understand the scope without exposing
  project IDs, artifact SHAs, deployment resource IDs, credentials, or CLI
  internals.
- A complete deployment may contain any ordered mix of `updated` and
  `unchanged` terminal target classifications and must return results in the
  intended-target order.
- The narrow slice does not retry artifacts or change Hosting, workflow release
  gates, Pages publication, or release markers.

Regression coverage should model a zero-exit quota-pressure outcome with one
missing target, assert exact safe metadata, reject identity-only evidence as
incomplete, and retain a complete mixed-result success case.
