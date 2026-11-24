# Requirements Analysis

- Accept an intended Firebase Function only when authoritative evidence explicitly identifies it as unchanged.
- Bind unchanged evidence to the exact project, function target, intended artifact, and deployed function identity.
- Reject inferred unchanged states, incomplete identities, free-form metadata, and extra unsupported fields.
- Preserve existing `current` and `updated` behavior; Hosting, quota, retry, and workflow gating remain out of scope.

## Root Cause

The classifier has no supported `unchanged` outcome. Treating any current-looking evidence as unchanged would be unsafe because a partial identity does not prove that Firebase evaluated the intended artifact and required no update.

## Acceptance Tests

- Complete, matching artifact-and-deployment evidence with `status: unchanged` passes.
- Artifact-only and deployment-only evidence relabeled `unchanged` fail.
- Existing current and updated evidence remains accepted.
