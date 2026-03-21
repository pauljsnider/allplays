Test strategy:
- Add a Playwright smoke spec that:
- verifies homepage footer `Help Center` and `Contact` links expose real destinations
- clicks homepage `Help Center` and confirms navigation reaches `help.html`
- verifies a shared-footer page (`login.html`) renders the same non-placeholder support links

Key regressions to watch:
- `href="#"`, empty hrefs, or hash-only same-page placeholders for support links
- homepage Help Center click leaving the user on `/` or only changing the hash
- shared footer drifting away from homepage support destinations

Validation plan:
- Run the existing unit suite to confirm no unrelated regressions.
- Run the smoke suite locally against a static server with Playwright Chromium installed.

Residual risks:
- `login.html` imports auth modules and could become a noisy smoke target if those imports begin hard-failing before footer render.
- CI smoke command changes slightly increase suite duration because all smoke specs run instead of one file.
