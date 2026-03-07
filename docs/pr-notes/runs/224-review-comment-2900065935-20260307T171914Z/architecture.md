# Architecture Role Summary

- Finding: the reviewed XSS claim on `formatBreakdownLine()` does not reproduce in this branch because `renderGameEarningsCard()` already wraps that output with `escapeHtml()`.
- Actual defect: dynamic IDs are injected into inline `onclick` handlers in `js/parent-incentives.js`, which creates a string-breakout risk if any identifier contains quotes or control characters.
- Decision: add a local `inlineHandlerString()` helper in `js/parent-incentives.js` that escapes for both JavaScript single-quoted string literals and HTML attribute embedding, then reuse it across all inline handlers in the module.
- Tradeoff: this keeps the patch minimal and contained; replacing inline handlers with delegated listeners would be cleaner long term but is larger blast radius for a review-fix follow-up.
