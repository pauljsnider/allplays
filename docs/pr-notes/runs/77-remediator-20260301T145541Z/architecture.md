# Architecture role (inline fallback)
- Current flow grants user coach access before team/code transaction to satisfy Firestore auth checks.
- Risk: if post-grant transaction fails, user profile may remain mutated without corresponding team/code updates.
- Add compensating rollback in catch path using pre-grant user snapshot and conditional arrayRemove operations.
