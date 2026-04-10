Objective: remove ambiguity in the support footer contract with the smallest possible production change.

Current state:
- Footer support links are duplicated between `index.html` and `js/utils.js`.
- Shared footer already avoids the `#` dead end, but the contact path is an external profile site rather than a direct support flow.

Proposed state:
- Both footer implementations expose the same concrete support destinations:
  - `Help Center` -> `help.html`
  - `Contact` -> `mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Support`

Blast radius:
- Public landing page footer.
- Any page using `renderFooter()`.

Controls:
- No data handling changes.
- Regression tests pin both href values so future drift fails fast.
