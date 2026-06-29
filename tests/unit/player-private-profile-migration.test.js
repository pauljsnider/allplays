import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
    cert: vi.fn((value) => value),
    getApps: vi.fn(() => []),
    initializeApp: vi.fn()
}), { virtual: true });

vi.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        delete: vi.fn(() => 'DELETE_FIELD'),
        serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP')
    },
    getFirestore: vi.fn()
}), { virtual: true });

describe('player private profile migration', () => {
    it('selects team, parents, and admins roster fields for private backfill', async () => {
        const { pickNonPublicRosterFieldValues } = await import('../../_migration/migrate-player-private-profile.js');

        expect(pickNonPublicRosterFieldValues({
            profile: {
                customFields: {
                    nickname: 'Rocket',
                    birthDate: '2014-02-03',
                    jerseySize: 'YM',
                    medicalNote: 'Peanut allergy'
                }
            }
        }, [
            { key: 'nickname', visibility: 'public' },
            { key: 'birthDate', visibility: 'team' },
            { key: 'jerseySize', visibility: 'parents' },
            { key: 'medicalNote', visibility: 'admins' }
        ])).toEqual({
            birthDate: '2014-02-03',
            jerseySize: 'YM',
            medicalNote: 'Peanut allergy'
        });
    });
});
