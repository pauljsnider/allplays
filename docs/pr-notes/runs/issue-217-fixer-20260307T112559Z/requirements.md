Objective: Add a minimal tournament bracket workflow to the existing team schedule system so admins can define seeded bracket slots, display bracket context on games, and auto-resolve downstream tournament slots when prior games finalize.

Current state:
- Games only store generic schedule fields plus `competitionType`.
- There is no persisted bracket slot metadata, no pool-seed mapping, and no advancement logic.

Proposed state:
- Tournament games can store bracket metadata and slot-source rules on the existing game document.
- Schedule UI exposes tournament-only inputs for bracket name, round, slot sources, and feed references.
- Finalizing a tracked game recomputes resolved tournament slots for bracket-linked games.

User requirements:
1. Tournament admins can mark a game as part of a bracket and define where each slot comes from.
2. Pool results can seed bracket slots through deterministic source descriptors.
3. Winner/loser references to prior games can resolve automatically once source games are completed.
4. Team-facing schedule cards show bracket round and resolved slot labels without needing a separate backend.

Non-goals for this patch:
- Full multi-division tournament management across multiple teams/orgs.
- Separate public bracket page, drag/drop bracket editor, or mobile-specific bracket flows.
- New Firestore collections or privileged backend jobs.

Assumptions:
- Team admins can manually enter pool standings input as bracket slot metadata for now.
- Existing game docs are the safest storage location for a first bracket slice.
- Automatic advancement can be limited to recomputing persisted slot-resolution state after game completion.

Blast radius:
- Limited to tournament-marked game documents, `edit-schedule.html`, `track-live.html`, and a new pure helper module.
