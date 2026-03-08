import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readFile(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('athlete profile wiring', () => {
    it('links parent dashboard player cards to the athlete profile builder', () => {
        const source = readFile('parent-dashboard.html');

        expect(source).toContain('athlete-profile-builder.html?teamId=${child.teamId}&playerId=${child.playerId}');
        expect(source).toContain('Athlete Profile');
    });

    it('includes builder fields for seasons, clips, and sharing privacy', () => {
        const source = readFile('athlete-profile-builder.html');

        expect(source).toContain('Selected Seasons');
        expect(source).toContain('Highlight Clips');
        expect(source).toContain('Share on the web');
    });

    it('includes a public athlete profile page with career stats and share action', () => {
        const source = readFile('athlete-profile.html');

        expect(source).toContain('Career Stats');
        expect(source).toContain('Highlight Clips');
        expect(source).toContain('Share Profile');
    });

    it('adds dedicated athlete profile security rules', () => {
        const source = readFile('firestore.rules');

        expect(source).toContain('match /athleteProfiles/{profileId}');
        expect(source).toContain("resource.data.privacy == 'public'");
        expect(source).toContain('resource.data.parentUserId == request.auth.uid');
    });

    it('guards private athlete profile reads and skips stale season keys in db helpers', () => {
        const source = readFile('js/db.js');

        expect(source).toContain("if (profile.privacy !== 'public' && !isOwner)");
        expect(source).toContain('const seasonLink = allowedSeasons.get(seasonKey);');
        expect(source).toContain('Season key ${seasonKey} not found in allowed seasons, skipping');
    });
});
