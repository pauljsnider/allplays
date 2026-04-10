# Architecture role notes

- Current state: Static sitemap with hard-coded `lastmod` dates set to `2026-03-03`.
- Proposed state: Keep static sitemap structure unchanged; replace hard-coded date with reviewer-requested valid historical date.
- Blast radius: Single static XML file; no JS/runtime/API impact.
- Controls: No auth/data access impact; zero tenant/PHI surface touched.
