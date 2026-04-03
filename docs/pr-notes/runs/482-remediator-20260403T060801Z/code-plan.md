# Code Role Notes

1. Add a helper in `js/db.js` to detect shared games for a team that reference a given `statTrackerConfigId`.
2. Update `deleteConfig(teamId, configId)` to block deletion when either team games or shared games still reference the config.
3. Run a lightweight validation pass for syntax and inspect the diff for scope.
4. Stage the scoped remediation plus required run notes and commit with a short imperative message.
