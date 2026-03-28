Decision: Keep the existing string-template rendering path, but add local escaping helpers and safe URL builders inside `js/homepage.js`.

Why:
- This is the smallest change that closes the XSS gap without refactoring the homepage to imperative DOM construction.
- Escaping text/attribute content and encoding query params directly addresses the reported attack surface with low blast radius.

Blast radius:
- Limited to homepage live-game and replay card markup generation.
- No backend, schema, or cross-page behavior changes.

Rollback:
- Revert the helper additions and card-template substitutions in `js/homepage.js`.
