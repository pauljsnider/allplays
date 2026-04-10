# Requirements Role (manual fallback)

## Objective
Ensure parent-invite signup does not report success unless invite-linking remains successfully applied.

## User-impact requirement
- If parent-invite finalization fails at profile stage, signup must fail clearly.
- Prevent "successful signup but not linked" outcome.

## Acceptance criteria
- `signup()` rejects when parent-invite linkage cannot be finalized.
- Error path keeps cleanup behavior for new auth user (best-effort delete/sign-out).
- Existing successful parent-invite signup path remains unchanged.

## Assumptions
- Current rollback behavior (reset code + linkage state) is intended on finalization failure.
- UX can tolerate explicit retry requirement on this failure mode.
