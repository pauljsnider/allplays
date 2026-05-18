# QA Plan for PR #1095 Remediation

## Objective
To ensure that the changes addressing PR #1095 review feedback resolve identified issues without introducing new regressions, with a strong focus on performance and data correctness.

## Risk Assessment
The primary risks are:
1.  **Performance Regression:** N+1 database queries for RSVPs can lead to high costs, timeouts, and service degradation under load. (High Severity)
2.  **Data Inaccuracy:** Incorrect mapping of officiating assignments (`officiatingSlots`) results in missing or incorrect information in the ICS feed. (Medium Severity)

## QA Strategy

### Feedback Item 1 & 3: Performance Regression (N+1 RSVP queries) & Avoid scanning every RSVP subcollection

**Issue:** Serial database queries for RSVPs and subcollection scanning per calendar request lead to N+1 query patterns, high latency, costs, and potential failures under load.

**Risk Mitigation Focus:** Reduce Firestore reads, improve response times under load, and ensure cost efficiency.

#### Automated Verification Standards:
*   **Unit Tests (Mocked Firestore):**
    *   **Objective:** Verify the refactored RSVP data fetching logic (batching or denormalization) correctly processes data with minimal simulated database calls.
    *   **Implementation:** Add/update unit tests for the functions responsible for fetching RSVP data. Mock Firestore client calls. Simulate scenarios with high numbers of events (50+) and RSVPs per event (10+). Assert that the number of mocked Firestore calls for RSVP data is within expected, optimized bounds (e.g., 1 batch read for all RSVPs, or using pre-computed `rsvpSummary` data).
    *   **Pass Criteria:** Tests pass, indicating the logic processes data efficiently with expected mocked query counts.
*   **Integration Tests (Firestore Emulator):**
    *   **Objective:** Verify end-to-end integration with Firestore, ensuring actual database read patterns are optimized.
    *   **Implementation:** Set up a test suite using a Firestore emulator. Seed the emulator with a realistic dataset, including multiple teams, games (e.g., 50-100), and RSVPs for each game (10-20 per game). Execute a full calendar feed request and monitor the Firestore emulator's logs for actual read counts.
    *   **Pass Criteria:** Total Firestore document reads for a given calendar request are significantly reduced (e.g., approaching O(1) for aggregated data or O(N/batch_size) for batched reads, where N is the number of events, rather than O(N*M) where M is RSVPs per event).
*   **Load/Performance Tests:**
    *   **Objective:** Validate performance under realistic client polling scenarios and ensure no timeouts or excessive resource usage.
    *   **Implementation:** Utilize a load testing tool (e.g., k6, Artillery) to simulate multiple concurrent calendar clients continuously polling the ICS feed endpoint.
    *   **Scenarios:**
        *   **Baseline:** Run tests against current production to establish metrics.
        *   **Post-Fix:** Run tests against the remediated version.
    *   **Metrics to Monitor:**
        *   Response Time (p90, p95 latency)
        *   Error Rate (should be 0%)
        *   Cloud Function execution duration
        *   Firestore read operations per request/per minute
        *   Cloud Function memory/CPU utilization
    *   **Pass Criteria:**
        *   Response times are within acceptable SLAs (e.g., < 1-2 seconds for p95).
        *   Error rate remains 0%.
        *   Firestore reads per calendar request are demonstrably lower than baseline.
        *   Cloud Function costs/durations are reduced for equivalent load compared to baseline.
*   **CI/CD Integration:** Performance checks (at least integration tests) should be integrated into the CI pipeline to gate merges and prevent future regressions.

#### Manual Verification Standards:
*   **Functional Testing:**
    *   **Objective:** Confirm basic functionality and perceived performance.
    *   **Steps:** Generate an ICS feed for a team with a high number of games. Import the feed into a common calendar client (Google Calendar, Outlook, Apple Calendar). Observe the time taken for initial sync and subsequent refreshes.
    *   **Pass Criteria:** Calendar syncs complete in a reasonable time, without noticeable lag or errors for the end-user.
*   **Monitoring (Post-Deployment):**
    *   **Objective:** Verify real-world performance and cost improvements in production.
    *   **Steps:** After deployment, observe Cloud Function logs, billing reports, and custom metrics (if implemented) for Firestore read counts and execution durations over several days.
    *   **Pass Criteria:** Confirm a significant reduction in Firestore reads and associated costs, along with stable or improved function execution times.

### Feedback Item 2: Read officiating assignments from the stored slot field

**Issue:** Officiating data is currently mapped from `game.officiating` or `game.officials` instead of the correct `game.officiatingSlots`, causing the `Officiating:` section in ICS feeds to be empty.

**Risk Mitigation Focus:** Ensure correct data mapping and display of officiating information in the ICS feed.

#### Automated Verification Standards:
*   **Unit Tests (ICS Builder Logic):**
    *   **Objective:** Verify that the ICS builder correctly extracts and formats officiating data from `game.officiatingSlots`.
    *   **Implementation:** Add/update unit tests for the ICS event creation logic. Create mock `game` objects with `officiatingSlots` populated with `officialName` and `position` fields (e.g., `[{ officialName: "John Doe", position: "Referee" }]`). Assert that the generated ICS event `DESCRIPTION` (or equivalent field) contains the expected "Officiating: John Doe (Referee)" string.
    *   **Pass Criteria:** Tests pass, confirming correct data extraction and formatting from `officiatingSlots`.
*   **Integration Tests (Firestore Emulator + ICS Generation):**
    *   **Objective:** Verify that when `game` documents in Firestore contain `officiatingSlots`, the generated ICS feed correctly reflects this.
    *   **Implementation:** Using the Firestore emulator, create a test `game` document with `officiatingSlots` populated. Generate the ICS feed for this game. Programmatically parse the generated `.ics` file content and assert that the `Officiating:` section is present and contains the correct details from the `officiatingSlots` data.
    *   **Pass Criteria:** The parsed ICS output matches the expected officiating assignments from the `officiatingSlots` field.

#### Manual Verification Standards:
*   **Functional Testing:**
    *   **Objective:** Visually confirm that officiating assignments appear correctly in calendar clients.
    *   **Steps:**
        1.  **Create New Data:** In the ALL PLAYS web app, create a new game event. Use the schedule editor to assign one or more officials, ensuring the data is saved to `officiatingSlots`.
        2.  **Generate & Import:** Generate the ICS feed for this game. Import the `.ics` file into a common calendar client (Google Calendar, Outlook, Apple Calendar).
        3.  **Inspect:** Open the event details in the calendar client. Verify that the "Officiating:" section is present and accurately displays the assigned official names and their positions.
        4.  **Verify Existing Data:** Test with existing game documents that are known to have `officiatingSlots` data. Ensure they also display correctly.
    *   **Pass Criteria:** The officiating section appears as expected in the calendar client, accurately reflecting the data stored in `officiatingSlots`.

## Conclusion
This QA strategy prioritizes the most critical performance issues with rigorous automated and manual checks, particularly focusing on load testing and Firestore interaction monitoring. It also ensures the functional correctness of officiating data display, utilizing both unit and integration tests, followed by manual functional verification in calendar clients. The goal is a robust, performant, and accurate calendar feed experience.