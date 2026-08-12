## Problem Statement

Opening the Social Feed or an accepted friend’s profile currently reads large pages of the viewer’s hidden-post history before loading a maximum of 30 posts. As hides accumulate, load cost and latency grow, and sufficiently large histories can prevent the timeline from rendering. The experience must instead verify hides only for bounded post candidates, with a fixed per-load candidate ceiling independent of total hide history.

## User Segments Impacted

- **Parents:** Need hidden posts to remain hidden without slower mobile loads as their history grows.
- **Coaches:** Need the feed and friend profiles to load predictably during time-sensitive team workflows.
- **Program managers/admins:** Need bounded Firestore cost and enforceable least-privilege access; administrative status must not expose another viewer’s private hide history.
- **All signed-in viewers:** Must receive identical viewer-local hide behavior across web, iOS, and Android.

## Acceptance Criteria

1. Opening the Social Feed or an accepted friend’s profile does not enumerate or cursor through the viewer’s complete `hiddenSocialPosts` history.
2. Hide checks are performed only for post IDs encountered within that surface’s bounded candidate set.
3. Each surface enforces one documented total candidate-scan ceiling per load, shared across all pages and feed branches, independent of the viewer’s historical hide count.
4. A viewer with more than 200 unrelated historical hides can still open the Social Feed and an accepted friend’s profile without those unrelated records being read.
5. A candidate remains excluded when its hide record exists, even if the viewer has more than 200 older or unrelated hide records.
6. When newer candidates are hidden, the service continues scanning older candidates until it finds up to 30 visible posts, exhausts available candidates, or reaches the total candidate ceiling.
7. Returned posts remain globally newest-first and never exceed 30 on either surface.
8. Duplicate candidate IDs encountered across pages or overlapping feed branches reuse the same hide result within one load and do not cause duplicate hide reads.
9. A load with no post candidates performs no hidden-post lookup.
10. If the candidate ceiling is reached before completeness can be established, any already verified visible posts may render with the existing retryable partial-data warning; the UI must not present an empty result as authoritative.
11. If a candidate’s hide status cannot be verified, that candidate is not rendered as visible, and the surface exposes a retryable partial-load state.
12. Viewer-local hide behavior remains consistent on React web and native Capacitor runtimes.
13. Firestore rules allow an authenticated owner to get an individual record from their own `hiddenSocialPosts` collection.
14. Firestore rules allow an authenticated owner to execute the approved bounded candidate lookup against their own collection.
15. Firestore rules reject hidden-post list requests without an explicit limit, requests exceeding the configured lookup limit, and list requests against another user’s collection.
16. Firestore rules reject individual hidden-post reads from another user’s collection.
17. Focused regression coverage proves behavior with more than 200 historical hides, a matching hidden candidate, visible older candidates, duplicate candidates, chunk boundaries, scan-budget exhaustion, and owner/cross-user query authorization.
18. Existing friendship authorization, global post visibility, reaction behavior, feed ranking, and hide persistence remain unchanged.

## Non-Goals

- Deleting, expiring, or pruning historical hide records.
- Resurfacing any post the viewer previously hid.
- Changing friendship authorization or profile visibility.
- Changing social-post visibility, global moderation, reactions, comments, or ranking.
- Increasing the 30-post render limit.
- Introducing a server-generated feed or new backend architecture.
- Granting admins access to another user’s private hide records.

## Edge Cases

- More than 200 historical hides exist, but none match current candidates.
- The matching hide record would have appeared beyond the first historical page under the old scan.
- An entire candidate page is hidden and older visible posts must be loaded.
- The same post appears in both visible-user and team-feed branches.
- Duplicate IDs appear across candidate pages.
- Candidate count lands exactly on a hide-query chunk boundary.
- The final candidate chunk is smaller than the configured query limit.
- The candidate budget is exhausted while more posts may exist.
- A hide lookup chunk fails while earlier chunks succeeded.
- No posts are available, so authoritative emptiness must be distinguished from a partial result.
- A viewer hides a post and immediately reloads the feed or profile.
- An accepted friend becomes unauthorized before profile loading completes.
- Native REST and web SDK query paths produce the same filtering and ordering.
- An owner performs an allowed single-document get while an unbounded, oversized, or cross-user list is attempted.

## Open Questions

- What single candidate-lookup chunk limit should be used by both clients and Firestore rules? It should remain within the smallest supported Firestore query-operator limit used by all supported runtimes.
- Confirm that the total candidate ceiling is shared across every visible-user and team branch in one Social Feed load, rather than applied independently per branch; shared accounting is recommended to make the maximum cost deterministic.
