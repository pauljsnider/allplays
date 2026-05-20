# Architecture Decisions for PR #1095 Remediation

## Objective
Address performance regressions and data mapping inaccuracies identified in PR #1095 review feedback, focusing on static-site, Firebase (Firestore), and overall system reliability.

## Current State
The ICS calendar feed generation performs N+1 database queries for RSVP data and incorrectly maps officiating assignments.

## Proposed State
The ICS calendar feed generation will be optimized to reduce database reads and accurately reflect officiating assignments by leveraging existing data structures where possible.

## Risk Surface and Blast Radius
-   **Performance**: Unaddressed N+1 queries could lead to high Firestore costs, increased latency, and potential function timeouts, especially for large teams or frequent calendar polling.
-   **Data Accuracy**: Incorrect officiating data mapping results in an incomplete and misleading calendar feed for users.
-   **Reliability**: Increased database load directly impacts the reliability and scalability of the Firebase function serving the ICS feed.

## Assumptions
-   The `rsvpSummary` field on the `game` document, if present, contains sufficient aggregate RSVP information (e.g., counts, status summaries) to fulfill the ICS feed requirements without needing to read individual RSVP subcollection documents.
-   The `game.officiatingSlots` field is consistently populated with officiating assignments during game creation/editing.
-   The ICS feed can be personalized to fetch only the relevant RSVP for the token holder, rather than all RSVPs for a game.

## Recommendation with Tradeoffs

### 1. Address N+1 RSVP Queries and Avoid Scanning Subcollections (Feedback 1 & 3)

**Decision**: Prioritize leveraging denormalized data on the `game` document and, if necessary, implement batched/personalized fetching.

**Why**: This directly addresses the critical performance regressions by significantly reducing Firestore read operations.

**Option 1 (Preferred): Leverage `rsvpSummary`**
-   **Approach**: Modify the ICS builder to read RSVP status and summaries directly from a denormalized `rsvpSummary` field on the `game` document. This eliminates the need for any subcollection queries for RSVPs during ICS generation.
-   **Tradeoffs**:
    -   **Pros**: Most performant and cost-effective solution. Reduces Firestore reads to 1 per game (for the game document itself). Highly scalable.
    -   **Cons**: Requires confirmation that `rsvpSummary` contains all necessary data for the ICS feed. If not, the `rsvpSummary` denormalization logic would need to be enhanced (which is outside the scope of *this* PR remediation, but an important consideration).

**Option 2 (Fallback): Batch RSVP Fetches / Personalized Fetching**
-   **Approach**:
    -   **Batching**: If `rsvpSummary` is insufficient or unavailable, modify the logic to perform a single batched query for all required RSVP subcollection documents for a set of games before event mapping. This could involve a collection group query on `rsvps` where `gameId` is in a list, or using multiple `getDocs` with `where` clauses (up to 10 `in` clauses).
    -   **Personalized Fetching**: If the ICS feed is intended for an individual user, only fetch the RSVP document relevant to that specific user (identified via authentication token) for each game, instead of all RSVPs.
-   **Tradeoffs**:
    -   **Pros**: Better than N+1 individual queries. Reduces overall read count.
    -   **Cons**: Still involves subcollection reads, which are less efficient than denormalized data. Requires careful management of query limits and potential complexity for filtering relevant RSVPs. Personalized fetching requires user context.

### 2. Read Officiating Assignments from Stored Slot Field (Feedback 2)

**Decision**: Correct the data source for officiating assignments.

**Why**: Ensures accurate and complete officiating information is included in the ICS feed, aligning with how the application persists this data.

**Approach**:
-   Modify the ICS builder to specifically extract officiating details (e.g., `officialName`, `position`) from the `game.officiatingSlots` array within the game document. The current mapping from `game.officiating` or `game.officials` should be removed or deprioritized.
-   **Tradeoffs**:
    -   **Pros**: Direct fix for data accuracy. Low implementation complexity.
    -   **Cons**: None, assuming `officiatingSlots` is reliably populated.

## Next Steps, Owners, and Measurable Outcomes

-   **Owner**: Paul (as the remediating agent)
-   **Next Steps**: Proceed with implementation based on the preferred architectural options.
-   **Measurable Outcomes**:
    -   Reduced Firestore read operations per ICS calendar feed request (quantifiable via Firebase monitoring).
    -   Accurate display of officiating assignments in generated ICS files.
    -   Elimination of timeouts related to N+1 queries during ICS generation.
