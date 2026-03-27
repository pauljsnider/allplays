# Requirements

- Objective: remove the blocking runtime error in login email/password submission on PR #393 while preserving the invite redemption race fix.
- Current state: the shared redirect coordinator exists, but one login submit path still calls a removed local helper.
- Proposed state: all login redirect reads go through the shared coordinator API consistently.
- Risk surface: auth redirect behavior on login, signup, and invite redemption flows.
- Assumptions: Amazon Q review is correct for the PR head branch; no product behavior change is intended beyond fixing the broken reference.
