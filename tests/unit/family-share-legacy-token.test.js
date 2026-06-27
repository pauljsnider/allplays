import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('legacy empty family share tokens', () => {
    it('wires a callable fallback before rendering family page children', () => {
        const familyPage = readRepoFile('family.html');
        const dbSource = readRepoFile('js/db.js');

        expect(dbSource).toContain('export async function resolveFamilyShareTokenChildren(tokenId)');
        expect(dbSource).toContain("httpsCallable(functions, 'resolveFamilyShareTokenChildren')");
        expect(dbSource).toContain('return normalizeFamilyShareChildren(response?.data?.children || []);');

        expect(familyPage).toContain('getFamilyShareToken, resolveFamilyShareTokenChildren, getTeam');
        expect(familyPage).toContain('function normalizeFamilyPageChildren(children = [])');
        expect(familyPage).toContain('async function resolveFamilyPageChildren(token)');
        expect(familyPage).toContain('const storedChildren = normalizeFamilyPageChildren(token?.children);');
        expect(familyPage).toContain('if (storedChildren.length > 0) return storedChildren;');
        expect(familyPage).toContain('return normalizeFamilyPageChildren(await resolveFamilyShareTokenChildren(tokenId));');
        expect(familyPage).toContain('const children = await resolveFamilyPageChildren(token);');
    });

    it('registers a backend resolver that validates the bearer token before reading owner scope', () => {
        const functionsSource = readRepoFile('functions/index.js');

        expect(functionsSource).toContain('exports.resolveFamilyShareTokenChildren = functions.https.onCall');
        expect(functionsSource).toContain('isFamilyShareTokenReadable(token)');
        expect(functionsSource).toContain('firestore.doc(`users/${ownerUserId}`).get()');
        expect(functionsSource).toContain('resolveFamilyShareChildrenFromOwnerProfile(ownerSnap.data() || {},');
        expect(functionsSource).toContain('firestore.doc(`teams/${teamId}/players/${playerId}`).get()');
    });
});
