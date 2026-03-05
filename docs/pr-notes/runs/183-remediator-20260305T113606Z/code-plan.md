# Code role plan (fallback inline)

1. Patch `autoAdvanceByes` in `js/bracket-management.js` to block auto-complete when the empty slot is `sourceType: 'winner'` with unresolved source game.
2. Add/adjust BYE regression unit test in `tests/unit/bracket-management.test.js` to enforce no premature championing.
3. Patch `getBrackets` in `js/db.js` to issue `where('status','==','published')` query when `onlyPublished` is true.
4. Keep `publishBracket` `publishedAt` assignment explicit and Timestamp-consistent.
5. Run focused unit tests and commit.
