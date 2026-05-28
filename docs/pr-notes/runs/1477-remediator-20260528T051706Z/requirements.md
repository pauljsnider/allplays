# Requirements role notes

## Acceptance criteria
- Non-manager contributors who uploaded a team media photo or file can see and use the delete control for their own item.
- Delete visibility stays aligned with the existing permission model: managers can delete, upload owners can delete photos/files, unrelated contributors cannot.
- Deleting one media item must not replace the whole Team Media page with the global loading state.
- While delete is in progress, only the target item delete action needs disabled/loading feedback; navigation, album controls, filters, and other actions remain available.

## Feedback classification
- PRRT_kwDOQe-T586FJOnF is actionable: owner delete control is missing in the React media page.
- PRRT_kwDOQe-T586FJNsu is informational but valid: global loading during delete creates avoidable page-wide blocking, so remediate with granular delete state.
