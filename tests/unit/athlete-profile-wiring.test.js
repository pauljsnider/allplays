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

    it('includes builder fields for native media uploads, curation, sharing privacy, and blob preview cleanup', () => {
        const source = readFile('athlete-profile-builder.html');

        expect(source).toContain('Upload Headshot');
        expect(source).toContain('Upload Clip');
        expect(source).toContain('Add External Link');
        expect(source).toContain('Move Up');
        expect(source).toContain('Share on the web');
        expect(source).toContain('URL.revokeObjectURL');
        expect(source).toContain('releaseProfilePhotoPreview();');
    });

    it('includes a public athlete profile page with inline media rendering and share action', () => {
        const source = readFile('athlete-profile.html');

        expect(source).toContain('Career Stats');
        expect(source).toContain('Highlight Clips');
        expect(source).toContain('Share Profile');
        expect(source).toContain('renderClipMedia');
        expect(source).toContain('data-athlete-clip-card');
    });

    it('adds dedicated athlete profile security rules', () => {
        const source = readFile('firestore.rules');

        expect(source).toContain('match /athleteProfiles/{profileId}');
        expect(source).toContain("resource.data.privacy == 'public'");
        expect(source).toContain('resource.data.parentUserId == request.auth.uid');
    });

    it('guards private athlete profile reads and adds athlete media upload helpers', () => {
        const source = readFile('js/db.js');

        expect(source).toContain("if (profile.privacy !== 'public' && !isOwner)");
        expect(source).toContain('const seasonLink = allowedSeasons.get(seasonKey);');
        expect(source).toContain('Season key ${seasonKey} not found in allowed seasons, skipping');
        expect(source).toContain('getTeam(link.teamId, { includeInactive: true })');
        expect(source).toContain('uploadAthleteProfileMedia');
        expect(source).toContain('deleteAthleteProfileMediaByPath');
        expect(source).toContain('collectAthleteProfileMediaCleanupPaths');
    });
});
