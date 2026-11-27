# Architecture analysis

## Current contract and defect mechanism

`verifyFirebaseApplicationDeployment` dispatches application, individual Function, and aggregate Function evidence. The application shape validates identity with `status: current` but contains no authoritative Hosting completion proof. Function validation is already independently dispatched and must remain unchanged.

## Minimal isolated design

1. Export a dedicated `firebase-hosting` target type.
2. Define exact expected Hosting identity fields (`projectId`, `siteId`) and exact Hosting evidence fields.
3. Add `verifyHostingDeployment` before existing application and Function branches.
4. Require exact terminal evidence for the expected site release and the overall Firebase deployment summary.
5. Return a frozen normalized Hosting result.

## Authority criteria

Evidence is authoritative only when the schema and target type are supported, project/site identity matches, the site-specific summary is exactly `✔  hosting[<siteId>]: release complete`, and the final summary is exactly `✔ Deploy complete!`. File upload, version finalization, release start, process exit, generic success text, or completion for another site are insufficient.

## Compatibility and validation

- Preserve all existing application and Function constants and shapes.
- Dispatch Hosting using either its target type or Hosting-specific expected identity so malformed Hosting evidence fails in the Hosting validator.
- Avoid permissive substring matching and reject extra fields.
- Validate with the focused deployment verifier unit file, including existing Function regressions.
