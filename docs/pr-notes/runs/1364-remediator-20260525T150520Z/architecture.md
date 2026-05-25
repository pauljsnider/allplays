# Architecture

Keep backend checkout eligibility as source of truth. Frontend pay gate should block terminal statuses and non-positive balances only, avoiding a narrower allowlist that strands migrated `adjusted` records. Blast radius is limited to Parent Tools fee action derivation.
