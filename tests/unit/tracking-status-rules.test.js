import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tracking status Firestore rules', () => {
    it('restricts tracking item and member status writes to team admins', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

        expect(rules).toContain('match /trackingItems/{itemId}');
        expect(rules).toContain('match /memberTracking/{trackingId}');
        expect(rules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || canReadPublicTrackingStatus(teamId, resource.data);');
        expect(rules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || canReadNestedTrackingStatus(teamId, itemId, trackingId, resource.data);');
        expect(rules).toContain('allow create, update, delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
