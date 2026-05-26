import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function getFunctionSource(source, functionName) {
    const start = source.indexOf(`export async function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = source.indexOf('\nexport async function ', start + 1);
    return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

describe('team tracking item db helpers', () => {
    it('creates tracking items with the Firestore rules-approved schema and audit fields', () => {
        const source = readDbSource();
        const createSource = getFunctionSource(source, 'createTeamTrackingItem');

        expect(createSource).toContain('const currentUserId = auth.currentUser?.uid;');
        expect(createSource).toContain("throw new Error('You must be signed in to create tracking items');");
        expect(createSource).toContain('name,');
        expect(createSource).toContain("visibility: itemData.visibility || 'private'");
        expect(createSource).toContain("status: 'active'");
        expect(createSource).toContain('active: true');
        expect(createSource).toContain('archived: false');
        expect(createSource).toContain('createdBy: currentUserId');
        expect(createSource).toContain('updatedBy: currentUserId');
        expect(createSource).not.toContain('scope:');
        expect(createSource).not.toContain('...itemData');
    });

    it('lists both legacy player-scoped and rules-compliant active tracking items', () => {
        const source = readDbSource();
        const listSource = getFunctionSource(source, 'listTeamTrackingItems');

        expect(listSource).toContain("title: data.title || data.name || ''");
        expect(listSource).toContain('item.active !== false');
        expect(listSource).toContain('item.archived !== true');
        expect(listSource).toContain("(!item.status || item.status === 'active')");
        expect(listSource).toContain("(!item.scope || item.scope === 'players')");
    });
});
