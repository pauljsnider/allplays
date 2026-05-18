# Architecture Plan: Develop Backend Logic for Publishing Organization Schedule Draft

## Objective
Implement a Firebase Callable Function to publish organization schedule drafts to team schedules, adhering to static-site, Firebase, and reliability constraints, while enforcing security and compliance.

## Current State
No dedicated backend logic exists for transforming and publishing an organization's draft schedule into an official team schedule within Firebase.

## Proposed State
A new Firebase Callable Function, `publishOrganizationSchedule`, will be responsible for receiving a draft schedule identifier, transforming its data into the target team schedule model, and persisting this new schedule in the Firebase database.

## Risk Surface and Blast Radius
-   **Data Integrity Risk**: Incorrect transformation or persistence logic could corrupt or inconsistently store team schedule data, leading to operational issues for teams.
-   **Security Risk**: Inadequate authorization within the Firebase Function could allow unauthorized users to publish schedules or access data outside their permitted scope, especially critical in a multi-tenant healthcare context.
-   **Performance Impact**: Inefficient database queries or writes within the function could lead to increased latency or resource consumption, affecting the overall application performance.
-   **Data Leakage/Segregation Failure**: Without stringent tenant isolation checks, there's a risk of inadvertently mapping or exposing one tenant's data to another during the transformation process.

## Assumptions
1.  A unique `draftScheduleId` is sufficient to retrieve the complete draft schedule document from a designated Firebase collection.
2.  The schema for the "draft schedule data model" and the "target team schedule data model" are well-defined and can be reliably mapped.
3.  Firebase Security Rules are configured to protect the underlying draft and team schedule data collections from direct unauthorized client access, leaving the Firebase Function as the controlled gateway.
4.  Client-side mechanisms (out of scope for this slice) will securely invoke the `publishOrganizationSchedule` Callable Function.

## Recommendation with Tradeoffs

**Core Recommendation:** Implement the publishing logic as a Firebase Callable Function.

**Tradeoffs:**
-   **Pros**:
    -   **Simplified Client Integration**: Callable functions offer a straightforward HTTP endpoint that integrates seamlessly with Firebase client SDKs, providing built-in authentication and request context.
    -   **Built-in Authentication & Authorization Context**: The `context.auth` object within a Callable Function provides secure access to the authenticated user's ID and claims, facilitating robust authorization checks.
    -   **Automatic Scaling**: Firebase Functions manage infrastructure scaling automatically, adapting to demand fluctuations without manual intervention.
    -   **Reduced Toil**: Abstracts server management, allowing focus on business logic.
-   **Cons**:
    -   **Explicit Client Trigger**: Requires a client application to explicitly invoke the function; it doesn't react passively to database changes (which aligns with the current slice's "out of scope" for trigger mechanisms).
    -   **Cold Start Latency**: Like all serverless functions, there can be a cold start delay for infrequently used functions, though this is generally optimized by Firebase.

## Architecture Decisions

1.  **Function Type**:
    *   **Decision**: Firebase Callable Function.
    *   **Details**: This type provides a secure, authenticated API for client applications (likely the static-site UI, once a trigger is in scope) to initiate the schedule publishing process. It will be defined in `firebase/functions/src/callable/schedule.ts`.

2.  **Input/Output Interface**:
    *   **Input**: The `publishOrganizationSchedule` function will accept a single JSON object containing `draftScheduleId: string`.
    *   **Output**: On successful execution, it will return a simple JSON response, e.g., `{ success: true, teamScheduleId: "generated-id" }`. In case of error, it will throw a `functions.https.HttpsError` with an appropriate status code and message.

3.  **Data Models & Persistence**:
    *   **Draft Schedule Retrieval**: The function will use the provided `draftScheduleId` to fetch the complete draft schedule document from a Firebase Firestore collection (e.g., `/organizationSchedulesDrafts/{draftScheduleId}`).
    *   **Transformation**: A dedicated, testable module within the function will handle the mapping logic from the draft schedule schema to the target team schedule schema.
    *   **Team Schedule Persistence**: The transformed team schedule will be written to a new document in a Firebase Firestore collection (e.g., `/teamSchedules/{teamScheduleId}`), with a newly generated unique ID.

4.  **Validation Strategy**:
    *   **Input Parameter Validation**: Verify that `draftScheduleId` is present and valid (e.g., non-empty string). If invalid, `HttpsError('invalid-argument')` will be thrown.
    *   **Draft Data Integrity**: Validate the retrieved draft schedule document to ensure it contains all necessary fields and conforms to expected data types *before* transformation.
    *   **Data Model Validation**: Ensure the transformed team schedule data adheres to its target schema prior to persistence.

5.  **Security and Access Control**:
    *   **Authorization within Function**: The Callable Function *must* perform explicit authorization checks using `context.auth`. It will verify that the authenticated user (`context.auth.uid`) possesses the necessary permissions (e.g., is an administrator or authorized manager for the organization associated with the `draftScheduleId`).
    *   **Tenant Isolation**: Crucially, the function will validate that the `draftScheduleId` corresponds to an organization the authenticated user is authorized to manage. This prevents cross-tenant data manipulation, a critical constraint in healthcare and multi-tenant environments. Any attempt to access unauthorized data will result in an `HttpsError('permission-denied')`.
    *   **Firebase Security Rules**: While the function bypasses client-side rules, strong security rules on the `organizationSchedulesDrafts` and `teamSchedules` collections will prevent direct unauthorized access to the underlying data from client applications.

6.  **Error Handling & Observability (Basic)**:
    *   **Graceful Degradation**: Implement basic `try-catch` blocks to handle potential errors during data retrieval, transformation, and persistence.
    *   **Error Reporting**: Use `functions.logger` to log errors and key operational events (e.g., function invoked, schedule published successfully, validation failed). Errors will be surfaced via `HttpsError` to the calling client.
    *   **Out of Scope Note**: Advanced error recovery, rollback, and detailed audit logging are explicitly out of scope for this slice, aligning with the issue description.

## Next Steps, Owners, and Measurable Outcomes

-   **Owner**: The "Code Expert" subagent is responsible for implementing this architecture.
-   **Next Steps**:
    1.  Define clear TypeScript interfaces for `DraftSchedule` and `TeamSchedule` data models.
    2.  Implement the `publishOrganizationSchedule` Callable Function in `firebase/functions/src/callable/schedule.ts`.
    3.  Integrate input validation and data integrity checks.
    4.  Develop the data transformation logic from draft to team schedule format.
    5.  Implement Firebase Admin SDK operations for fetching the draft and persisting the new team schedule.
    6.  Embed robust authorization checks using `context.auth` to ensure tenant isolation and proper permissions.
    7.  Add basic `functions.logger` statements for debugging and operational monitoring.
-   **Measurable Outcomes**:
    *   Successful invocation of `publishOrganizationSchedule` with valid `draftScheduleId` results in a new, correctly structured `teamSchedule` document in Firestore.
    *   Invalid `draftScheduleId` inputs result in `HttpsError('invalid-argument')`.
    *   Attempts by unauthorized users to publish schedules result in `HttpsError('permission-denied')`.
    *   The function demonstrates reliable data transformation and persistence under normal operating conditions.
    *   Function execution time (latency) remains within acceptable limits (to be defined and validated by the QA Expert).
