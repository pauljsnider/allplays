# Player/Team Matching Feed — Tasks

- [x] 1. Shared logic module `apps/app/src/lib/matchingLogic.ts` (reqs 1.4–1.7, 2.3, 2.5, 4.2, 5.1, 5.5)
- [x] 2. Service module `apps/app/src/lib/matchingService.ts` + `deleteDoc` adapter export (reqs 1.6, 2.2, 3.1–3.7, 4.1–4.5, 6.4)
- [x] 3. Home feed integration in `socialService.loadSocialHome` (req 2.1)
- [x] 4. `socialLogic` type/label extensions for the new post types and community visibility (req 1.1)
- [x] 5. `/opportunities` page with browse, filters, composers, respond, my-posts (reqs 1.1–1.5, 2.2, 3.1–3.2, 3.7, 4.1, 5.5)
- [x] 6. Home entry links + respond-only feed cards (reqs 2.1, 5.7; report stays enabled per 5.2)
- [x] 7. Firestore rules: community create/read/lifecycle, responses subcollection, notification create, comment/reaction block (reqs 2.4, 5.1, 5.4, 5.7, 6.3)
- [x] 8. Unit + integration tests, coverage map registration (req 6.2)
- [ ] 9. Playwright smoke spec for the opportunities route (follow-up; tracked in coverage map)
- [ ] 10. Server-side report-count auto-hide at 3 open reports (follow-up for req 5.3)
