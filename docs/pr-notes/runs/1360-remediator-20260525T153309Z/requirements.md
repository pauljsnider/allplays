# Requirements

- Approved parents with `teamMediaUploadTeamIds` or legacy `mediaUploadTeamIds` for a team must see media upload controls in legacy web and app flows.
- Parent/team membership alone must not grant upload contribution.
- Full team access users continue to contribute through existing owner/admin paths.
- Missing, malformed, or cross-team grant values must not over-permit.
- Regression coverage must prove auth hydration preserves grant fields before `canContributeTeamMedia` evaluates them.
