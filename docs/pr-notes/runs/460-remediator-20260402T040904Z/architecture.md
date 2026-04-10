Architecture role
Objective: preserve user-visible card count without broad refactor.
Current state: query uses date window + ordering + limit, then filters cancelled in JS.
Proposed state: move cancelled exclusion into the query if Firestore supports it with the current ordering, else keep the query stable and over-fetch modestly before final slice.
Blast radius: one read helper in js/db.js; no schema changes.
Controls: keep same public interface and same returned shape.
Tradeoff: in-query filtering is cleaner and cheaper, but may require composite index support; bounded over-fetch is more compatible but slightly increases reads.
Recommendation: choose the smallest compatible fix after inspecting current query shape.
