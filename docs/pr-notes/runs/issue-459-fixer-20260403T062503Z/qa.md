Test focus:
- Footer support links must never regress to `#`, empty hrefs, or unrelated destinations.
- Public homepage and shared-footer pages must expose the same help workflow contract.

Fail conditions:
- `Help Center` is not `help.html`.
- `Contact` is not a direct `mailto:` support destination.
- Clicking `Help Center` fails to load the help center page.

Validation plan:
- Run targeted Vitest coverage for footer/help navigation.
- Keep the existing smoke spec aligned with the production hrefs.
