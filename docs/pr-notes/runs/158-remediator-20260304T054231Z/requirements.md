# Requirements role notes

- Objective: Resolve PR thread PRRT_kwDOQe-T585x-bYh by fixing invalid/future `lastmod` values in `sitemap.xml`.
- Scope: Only adjust sitemap `lastmod` dates as requested by review feedback.
- Acceptance criteria:
  - `sitemap.xml` uses a non-future date accepted by crawlers.
  - Both URL entries have consistent `lastmod` values.
  - No unrelated file behavior changes.
