# Code Role Plan (Fallback Synthesis)

Skill availability note: `allplays-orchestrator-playbook` and `allplays-code-expert` were requested but are not present in this session's available skill list. This document captures equivalent implementation plan.

## Plan
1. Add/adjust unit test to include realistic `U12 Practice` summary classification and keep game control.
2. Patch `calendar.html` ICS mapping to use summary-based fallback classifier when `ev.isPractice` is missing.
3. Run targeted unit tests for updated file.
4. Stage changed files and commit with issue reference.

## Conflict Resolution Across Roles
- Requirements asks for user-visible filter correctness.
- Architecture prefers minimal localized fix.
- QA requires regression guard.
- Combined approach: keep parser tests and calendar fallback mapping to guarantee correctness even if parser output varies.
