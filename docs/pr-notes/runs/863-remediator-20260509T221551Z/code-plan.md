# Code Plan

- Edit `js/db.js` only.
- Replace `(status || '').toLowerCase()` with an explicit `typeof status === 'string'` guard.
- Keep helper signature and callers unchanged.
