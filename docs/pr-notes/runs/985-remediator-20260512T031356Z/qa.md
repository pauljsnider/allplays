# QA Plan

- In `edit-config.html`, choose Public leaderboard Top Stat with visibility `private` and scope `player`; click Add/Update and confirm an alert appears and the textarea is unchanged.
- Choose Public leaderboard Top Stat with visibility `public` and scope `team`; click Add/Update and confirm an alert appears and the textarea is unchanged.
- Choose Public leaderboard Top Stat with visibility `public` and scope `player`; click Add/Update and confirm the line is added with `topStat=true`.
- Confirm save-time validation still rejects invalid definitions typed directly into the textarea.
