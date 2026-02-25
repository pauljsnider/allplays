# Code Role Notes

## Patch Scope
1. Add `sanitizeInlineCapture()` and `escapeHtmlAttr()` helpers.
2. Add `normalizeSafeHttpUrl()` and use it in trailing punctuation handling + linkification.
3. Update `applyInlineMd()` replacements to function callbacks that sanitize captured content before wrapping.
4. Extend `test-fix-schedule-drills.html` with malformed URL and href-breakout checks.

## Conflict Resolution
- Review comment requested full URL hardening and capture sanitization.
- Existing parser already escaped top-level input; patch keeps that control and adds defense-in-depth at insertion points.
