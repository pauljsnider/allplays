# Code Plan

- Move `registrationUpdate` construction below the paid guard.
- Remove the registration write from the paid branch.
- Add source-level unit coverage for the guard/write ordering.
