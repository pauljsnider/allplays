# Code Plan

Patch only smoke fixtures that mock /js/db.js. Add sponsor CRUD exports required by edit-schedule.html:
- getSponsors returns an empty sponsor list or test state sponsors
- addSponsor/updateSponsor/deleteSponsor are harmless async no-ops

Run focused Playwright smoke tests if dependencies are available, then commit.
