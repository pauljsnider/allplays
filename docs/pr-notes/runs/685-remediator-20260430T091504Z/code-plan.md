# Code plan

Thread: PRRT_kwDOQe-T585-rW3q

Code role timed out before returning a full plan, so main remediator used requirements, architecture, and QA guidance.

Plan:
1. Inspect `firestore.rules` sponsor match block.
2. Replace direct optional field dereferences in public sponsor read predicate with guarded reads using `resource.data.get(...)` or equivalent helper.
3. Keep file scope to `firestore.rules` plus these required role notes.
4. Run the smallest available validation for Firestore rules syntax/tooling.
5. Commit without pushing.
