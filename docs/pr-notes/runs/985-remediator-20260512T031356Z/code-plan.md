# Code Plan

- Edit `edit-config.html` only.
- Add a guard in `addOrUpdateStatDefinitionLine()` after `visibility`, `scope`, and `topStat` are read.
- If `topStat` is true and either visibility is not `public` or scope is not `player`, alert the existing validation message and return before mutating the textarea.
- Leave existing submission validation untouched.
