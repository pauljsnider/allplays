Objective: close the help dead end by ensuring the footer exposes a direct support workflow on public and authenticated pages.

Current state:
- `Help Center` resolves to `help.html`.
- `Contact` resolves to `https://paulsnider.net`, which is live but indirect as a support path.

Proposed state:
- `Contact` resolves to a direct `mailto:` support workflow from both the shared footer and the homepage footer.

Risk surface and blast radius:
- Touches only footer support links on pages that render the shared footer and the homepage.
- No auth, data, or tenant isolation behavior changes.

Assumptions:
- `paul@paulsnider.net` is the intended support inbox.
- A direct email compose flow is acceptable for the reported workflow.

Recommendation:
- Keep `Help Center` on `help.html`.
- Change `Contact` to a direct `mailto:` destination and add regression coverage for both footer implementations.
