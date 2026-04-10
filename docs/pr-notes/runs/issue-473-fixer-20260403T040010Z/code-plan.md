## Plan
- Add failing homepage unit expectations for parent vs coach CTA destinations.
- Update homepage CTA logic to consume the shared auth redirect helper.
- Run targeted and broad unit validation.
- Commit the focused patch for issue #473 without unrelated changes.

## Implementation Notes
- Keep the patch minimal and homepage-scoped.
- Avoid duplicating role logic in `js/homepage.js`.
- Preserve existing guest copy and link behavior.
