# QA Role Notes

## Regression Guardrails
- Verify existing formatting still renders: headings, lists, bold, italic, code, valid URLs.
- Verify security cases:
  - script tags remain escaped
  - inline event handlers remain escaped
  - malformed hostname URLs are not linkified
  - encoded quote payload in URL cannot break anchor attribute context

## Validation Plan
- Run deterministic Node assertions directly against `parseMarkdown` export.
- Confirm no raw `<script>`/`<img>`/`onerror="` output appears.
