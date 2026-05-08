import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tracking status Firestore rules', () => {
    it('restricts tracking item and member status writes to team admins', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

        expect(rules).toContain('match /trackingItems/{itemId}');
        expect(rules).toContain('match /memberTracking/{playerId}');
        expect(rules).toContain('allow read: if isTeamOwnerOrAdmin(teamId);');
        expect(rules).toContain('allow create, update: if isTeamOwnerOrAdmin(teamId)');
        expect(rules).toContain("request.resource.data.get('status', 'incomplete') in ['complete', 'incomplete']");
    });
});
