import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('public teams visibility', () => {
    it('keeps public team browsing opt-in and preserves accessible private teams by default', () => {
        const source = readRepoFile('js/db.js');

        expect(source).toContain('const publicOnly = options.publicOnly === true;');
        expect(source).toContain('const includePrivate = options.includePrivate === true || includeInactive;');
        expect(source).toContain('} else if (publicOnly) {');
        expect(source).toContain('getDocs(query(teamsRef, where("ownerId", "==", currentUser.uid)))');
        expect(source).toContain('getDocs(query(teamsRef, where("adminEmails", "array-contains", currentUserEmail)))');
        expect(source).not.toContain('const q = includePrivate');
    });

    it('wires Browse Teams to the public-only helper path and keeps a defensive client filter', () => {
        const source = readRepoFile('teams.html');

        expect(source).toContain("import { getTeams } from './js/db.js?v=32';");
        expect(source).toContain('getTeams(locationFilter ? { locationFilter, publicOnly: true } : { publicOnly: true })');
        expect(source).toContain('allTeams.filter(t => t.isPublic === true)');
        expect(source).not.toContain('getTeams(locationFilter ? { locationFilter } : {})');
    });

    it('does not allow anonymous reads of private team documents in Firestore rules', () => {
        const rules = readRepoFile('firestore.rules');

        expect(rules).toContain('function canReadTeamDocument(data)');
        expect(rules).toContain('return (data.isPublic is bool && data.isPublic == true) ||');
        expect(rules).toContain('allow read: if canReadTeamDocument(resource.data);');
        expect(rules).not.toContain('allow read: if true;  // Public teams for browsing');
    });
});
