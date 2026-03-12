Decision: keep formula evaluation local to `js/stat-leaderboards.js` and replace the runtime compiler with a tiny parser/evaluator.

Reasoning:
- The allowed expression language is already narrow: identifiers, parentheses, `+ - * /`, and `%` as a percentage shorthand.
- A small tokenizer plus recursive-descent evaluator removes the code-execution path without introducing a new dependency.
- Preserving `_` in normalized keys aligns config IDs and formula token resolution with how aggregated stats are stored (`col.toLowerCase()`).

Blast radius:
- Limited to leaderboard config normalization and derived stat computation.
- Existing formulas using the supported arithmetic grammar should continue to work.
