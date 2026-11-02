# Architecture Analysis

> Fallback artifact: the requested architecture subagent was dispatched, but the runtime rejected the role before execution. This analysis was completed in the main lane from repository and issue evidence.

## Root cause

`help.html` builds contextual workflow-card URLs, but static workflow articles use plain relative links in their Related Workflows sections. The shared `js/help-context.js` module only selects `data-help-back-link` anchors, so it never decorates article-to-article navigation. Once a plain related link is followed, the destination has no team parameters and cannot reconstruct them for its Back link.

## Minimal design

Extend the existing shared context helper to process both:

- `a[data-help-back-link]`
- anchors in the content following the `#related-workflows` heading, up to the next `h2`

Keep the existing team-context gate and allow-list of `context`, `teamId`, and `role`. Resolve links against the document URL and only rewrite same-origin destinations. This fixes every current Related Workflows section without assuming the heading contains the links.

## Recurrence risk

Low after centralizing the rewrite in the helper loaded by every workflow article. The main residual risk is a future related-workflow UI that does not use the established `#related-workflows` section.
