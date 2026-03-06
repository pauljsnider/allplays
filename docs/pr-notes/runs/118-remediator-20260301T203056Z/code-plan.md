# Code Role Plan (Fallback Inline Analysis)

1. Edit `calendar.html` and change `./js/utils.js?v=8` to `./js/utils.js?v=9` on the named import line.
2. Verify with `rg` that the import now uses `v=9`.
3. Review `git diff` for single-scope patch.
4. Stage changed files and commit with an imperative message.
