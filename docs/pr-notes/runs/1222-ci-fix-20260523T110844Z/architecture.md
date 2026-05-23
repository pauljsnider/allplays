# Architecture notes

## Root cause
`edit-roster.html` imported Firebase modules at page module load time for flows that are not needed for initial roster rendering:

- registration screening write helpers imported `./js/firebase.js?v=15`
- Bulk AI imported `./js/vendor/firebase-app.js` and `./js/vendor/firebase-ai.js`

The smoke tests stub Firebase vendor modules for isolated page testing. Pulling Firebase during initial page boot can break that module graph before `document.getElementById('team-name-display').textContent = team.name;` runs, leaving `#team-name-display` empty.

## Decision
Keep edit-roster initial page boot independent of Firebase module side effects. Lazy-load Firebase only when the specific feature path needs it:

- registration screening update dynamically imports `./js/firebase.js?v=15`
- Bulk AI dynamically imports Firebase App and Firebase AI through a cached helper
- Bulk AI preloads on tab open so repeated runs do not add a new async gap

## Risk and rollback
Blast radius is limited to registration screening updates and Bulk AI roster parsing. Core roster rendering now has less startup coupling. Rollback is restoring the static imports if lazy loading causes a production-only issue.
