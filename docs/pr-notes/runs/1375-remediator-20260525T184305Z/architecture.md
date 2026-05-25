# Architecture

- Treat Firestore as the source of truth for one-tap preference updates.
- Capture the selected team id at action start to avoid races across async work.
- Re-load current preferences before merging game-day defaults, then save only the intended `liveScore` and `schedule` changes while preserving all other fields.
