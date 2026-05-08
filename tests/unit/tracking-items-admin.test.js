import { describe, expect, it } from 'vitest';
import {
    filterTrackingItemsForAdminList,
    isTrackingItemAdmin,
    normalizeTrackingItemDraft,
    normalizeTrackingItemStatus
} from '../../js/tracking-items-admin.js';

describe('tracking items admin helpers', () => {
    it('normalizes draft metadata and defaults active private items', () => {
        expect(normalizeTrackingItemDraft({
            name: ' Medical release ',
            description: ' Upload before first practice ',
            visibility: 'public'
        })).toEqual({
            name: 'Medical release',
            description: 'Upload before first practice',
            visibility: 'public',
            status: 'active',
            archived: false,
            active: true
        });
    });

    it('requires a name and normalizes invalid visibility and status values', () => {
        expect(() => normalizeTrackingItemDraft({ name: ' ' })).toThrow('Tracking item name');
        expect(normalizeTrackingItemDraft({ name: 'Waiver', visibility: 'team', status: 'done' })).toMatchObject({
            visibility: 'private',
            status: 'active',
            archived: false,
            active: true
        });
    });

    it('tracks archived status consistently for active lists', () => {
        const items = [
            { id: 'archived-status', name: 'Z', status: 'archived', archived: true, active: false },
            { id: 'archived-legacy', name: 'A', active: false },
            { id: 'active', name: 'M', status: 'active', archived: false, active: true }
        ];

        expect(normalizeTrackingItemStatus(items[0])).toBe('archived');
        expect(normalizeTrackingItemStatus(items[1])).toBe('archived');
        expect(filterTrackingItemsForAdminList(items).map((item) => item.id)).toEqual(['active']);
        expect(filterTrackingItemsForAdminList(items, { includeArchived: true }).map((item) => item.id)).toEqual([
            'archived-legacy',
            'active',
            'archived-status'
        ]);
    });

    it('allows only owners, team admins, global admins, or delegated moderators', () => {
        const team = { ownerId: 'owner-1', adminEmails: ['Coach@Example.com'] };

        expect(isTrackingItemAdmin(team, { uid: 'owner-1' })).toBe(true);
        expect(isTrackingItemAdmin(team, { email: 'coach@example.com' })).toBe(true);
        expect(isTrackingItemAdmin(team, { isAdmin: true })).toBe(true);
        expect(isTrackingItemAdmin(team, { uid: 'moderator-1' }, () => true)).toBe(true);
        expect(isTrackingItemAdmin(team, { email: 'parent@example.com' })).toBe(false);
    });
});
