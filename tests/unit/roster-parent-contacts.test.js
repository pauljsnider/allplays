import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildLinkedParentContacts } from '../../js/roster-parent-contacts.js';

describe('buildLinkedParentContacts', () => {
    it('builds chips from player.parents when the /users directory is unavailable', () => {
        // Regression: coaches (non-global-admins) get [] from getAllUsers, so
        // chips must come from the player doc's linked parent accounts.
        const player = {
            id: 'player-1',
            parents: [
                { userId: 'u-coach', email: 'coach@allplays.ai', relation: 'Father' },
                { userId: 'u-dad', email: 'dad@allplays.ai', relation: 'Guardian' }
            ]
        };
        const result = buildLinkedParentContacts(player, []);
        expect(result.map((p) => p.email)).toEqual(['coach@allplays.ai', 'dad@allplays.ai']);
        expect(result.map((p) => p.userId)).toEqual(['u-coach', 'u-dad']);
    });

    it('excludes household delegated and removed contacts', () => {
        const player = {
            parents: [
                { userId: 'u-linked', email: 'linked@allplays.ai' },
                { userId: 'u-household', email: 'gran@allplays.ai', source: 'household' },
                { userId: 'u-removed', email: 'old@allplays.ai', status: 'removed' },
                { userId: 'u-invited', email: 'inv@allplays.ai', invitedByUserId: 'u-organizer' }
            ]
        };
        const result = buildLinkedParentContacts(player, []);
        expect(result.map((p) => p.userId)).toEqual(['u-linked']);
    });

    it('dedupes directory links and player-doc links by userId, preferring a real email', () => {
        const player = { parents: [{ userId: 'u-dad', email: 'dad@allplays.ai', relation: 'Dad' }] };
        const usersDerived = [{ userId: 'u-dad', email: 'Pending', name: 'Parent', relation: null }];
        const result = buildLinkedParentContacts(player, usersDerived);
        expect(result).toHaveLength(1);
        expect(result[0].email).toBe('dad@allplays.ai');
        expect(result[0].relation).toBe('Dad');
    });

    it('ignores parent entries without a userId', () => {
        const player = { parents: [{ email: 'no-account@allplays.ai' }] };
        expect(buildLinkedParentContacts(player, [])).toEqual([]);
    });
});

describe('edit-roster parent chip wiring', () => {
    it('imports and uses buildLinkedParentContacts to source parent chips', () => {
        const source = readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');
        expect(source).toContain("import { buildLinkedParentContacts } from './js/roster-parent-contacts.js");
        expect(source).toContain('buildLinkedParentContacts(player, parentsByPlayerId.get(player.id)');
    });
});
