# QA notes

- Subagent spawn was unavailable in this environment, so inline QA analysis was used.
- Automated coverage: unit test sortSubstitutionPeriods with non-chronological persisted labels.
- Existing source-inspection test should continue to verify game-day period normalization is wired.
- Manual scenario: persisted rotationPlan keys inserted as H1 14', H1 7', H1 21' should render H1 7', H1 14', H1 21' and default active tab to H1 7'.
