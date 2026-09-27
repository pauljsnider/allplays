# Acceptance Criteria

React makes one recipient query and zero private detail reads for 100 flagged recipients while preserving model data, totals, and actions. Legacy default hydration, reconciliation notes, and online refunds remain intact.

# Architecture Decisions

Use an explicit default-on loader option and opt out only at the React call site. No data, rules, Stripe, pagination, or platform-specific changes.

# QA Plan

Split proof by layer: DB test for request cardinality, service test for option/mapping, component test for 100-recipient UI behavior, and legacy smoke for hydrated metadata consumption.

# Implementation Plan

Write regressions first, implement the two-line behavioral boundary, advance the transitive cache-bust graph, then run only focused validation.

# Risks And Rollback

Primary risks are a changed legacy default or stale mixed module versions. Tests lock the default and the cache guard locks delivery. Rollback requires only reverting code and cache keys; no data repair is required.
