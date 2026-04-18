# Architecture

## Architecture Decisions
- Keep the fix inside the tests. No production HTML or hosting config changes are needed.
- Use a Windows-safe normalization at the point where the unit test converts `import.meta.url` into a filesystem path.
- In smoke coverage, verify the response body is not the same as the `/index.html` fallback for non-index HTML files.

## Tradeoffs
- Comparing against the deployed fallback body is a narrow assertion, but it directly targets the Firebase rewrite failure mode called out in review.
- A more generic content-signature system would be stronger long term, but it adds scope and maintenance overhead unrelated to this PR feedback.

## Recommendation
- Make the two targeted test-only changes and validate with the affected unit suite plus the help-center smoke spec if Playwright is available locally.
