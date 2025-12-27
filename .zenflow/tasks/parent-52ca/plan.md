# Full SDD workflow

## Configuration
- **Artifacts Path**: {@artifacts_path} → `.zenflow/tasks/{task_id}`

---

## Workflow Steps

### [x] Step: Requirements
<!-- chat-id: 32cfc8f1-cbee-4996-8f0a-e3622acc85ce -->

Create a Product Requirements Document (PRD) based on the feature description.

1. Review existing codebase to understand current architecture and patterns
2. Analyze the feature definition and identify unclear aspects
3. Ask the user for clarifications on aspects that significantly impact scope or user experience
4. Make reasonable decisions for minor details based on context and conventions
5. If user can't clarify, make a decision, state the assumption, and continue

Save the PRD to `{@artifacts_path}/requirements.md`.

### [x] Step: Technical Specification

Create a technical specification based on the PRD in `{@artifacts_path}/requirements.md`.

1. Review existing codebase architecture and identify reusable components
2. Define the implementation approach

Save to `{@artifacts_path}/spec.md` with:
- Technical context (language, dependencies)
- Implementation approach referencing existing code patterns
- Source code structure changes
- Data model / API / interface changes
- Delivery phases (incremental, testable milestones)
- Verification approach using project lint/test commands

### [x] Step: Planning

Create a detailed implementation plan based on `{@artifacts_path}/spec.md`.

1. Break down the work into concrete tasks
2. Each task should reference relevant contracts and include verification steps
3. Replace the Implementation step below with the planned tasks

Rule of thumb for step size: each step should represent a coherent unit of work (e.g., implement a component, add an API endpoint, write tests for a module). Avoid steps that are too granular (single function) or too broad (entire feature).

If the feature is trivial and doesn't warrant full specification, update this workflow to remove unnecessary steps and explain the reasoning to the user.

Save to `{@artifacts_path}/plan.md`.

### [x] Step: Implementation

#### [x] Task 1: Database & Auth Logic
- **File**: `js/db.js`
    - Implement `inviteParent(teamId, playerId, relation)`
    - Implement `redeemAccessCode(code)`
    - Implement `getParentDashboardData(userId)`
- **File**: `js/auth.js`
    - Update `checkAuth` to process `parentOf` and `coachOf` fields.
    - Update Login redirect logic.
- **Verification**: Test generating code and redeeming it in console.

#### [x] Task 2: Parent Dashboard UI
- **File**: `parent-dashboard.html` (New)
- **File**: `js/parent-dashboard.js` (New)
    - Implement fetching logic using `getParentDashboardData`.
    - Render "Upcoming Games" (combined).
    - Render "My Players".
- **Verification**: Login as parent, verify dashboard loads correct data.

#### [x] Task 3: Coach Invite UI
- **File**: `edit-roster.html`
- **File**: `js/edit-roster.js` (or inline script)
    - Add "Invite Parent" button to player rows.
    - Add Modal to collect email/relation and show code.
- **Verification**: Invite a parent, copy code.

#### [x] Task 4: Player Profile Edit (Parent View)
- **File**: `player.html`
    - Add "Edit Profile" button (visible to parent).
    - Add Modal for editing Photo, Emergency Contact.
    - Implement `updatePlayerProfile` restricted call.
- **Verification**: As parent, change photo. Verify success. Try changing name (should fail).

#### [x] Task 5: Security Rules
- **File**: `firestore.rules`
    - Allow parents to update specific fields on player docs.
    - Protect team writes.
- **Verification**: Run Firestore emulator tests or manual verification.

### [x] Step: Validation
<!-- chat-id: cd883a90-ba4a-4c2a-adbe-ec5b95915db8 -->
<!-- agent: CODEX -->

Test everything you created

### [ ] Step: Functional validation
<!-- agent: GEMINI -->

use playwright MCP to validate the changes.
