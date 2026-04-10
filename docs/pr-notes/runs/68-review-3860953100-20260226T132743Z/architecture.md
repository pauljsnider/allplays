# Architecture Role Summary

## Decision
Use call-site fallback in `accept-invite.html` instead of weakening validation in shared helper.

## Why
- Keeps `js/admin-invite.js` contract strict (`userEmail` required).
- Fixes edge case closest to source of missing data.
- Minimizes shared-module behavior changes and regression risk.

## Controls Equivalence
- Access control and Firestore write paths are unchanged.
- Data written remains `team.adminEmails` and user profile role/team arrays via existing helper.

## Rollback
Revert this single-file change in `accept-invite.html` if regression occurs.
