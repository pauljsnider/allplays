// Minimal file-backed persistence for the OAuth broker's long-lived state
// (registered clients + refresh-token grants). Good enough for a single
// dev/Cloud-Run instance; a multi-instance deploy needs Firestore instead
// (see spec task 15b).
//
// Note: the file holds Firebase refresh tokens, which are user credentials.
// Keep it out of the repo (see .gitignore) and off shared disks. Persistence
// is opt-in via OAUTH_STORE_PATH so it's never written unless configured.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export function createFileStore(path) {
    return {
        load() {
            try {
                return JSON.parse(readFileSync(path, 'utf8'));
            } catch (error) {
                if (error.code === 'ENOENT') return null;
                throw error;
            }
        },
        save(state) {
            mkdirSync(dirname(path), { recursive: true });
            // Write-then-rename so a crash mid-write can't corrupt the store.
            const tmp = `${path}.tmp`;
            writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
            renameSync(tmp, path);
        }
    };
}
