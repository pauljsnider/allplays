import { describe, expect, it } from 'vitest';
import { normalizeRosterFieldDefinitions, splitRosterProfileValuesByVisibility } from './legacyRosterPrivacy';

describe('legacy roster privacy adapter', () => {
    it('keeps restricted roster fields out of public player profile storage while preserving private values', () => {
        const fields = normalizeRosterFieldDefinitions([
            { key: 'nickname', label: 'Nickname', visibility: 'public' },
            { key: 'birthDate', label: 'Birth Date', type: 'date', visibility: 'team' },
            { key: 'jerseySize', label: 'Jersey Size', visibility: 'parents' },
            { key: 'medicalNote', label: 'Medical Note', visibility: 'admins' }
        ]);

        expect(splitRosterProfileValuesByVisibility(fields, {
            nickname: 'Rocket',
            birthDate: '2014-02-03',
            jerseySize: 'YM',
            medicalNote: 'Peanut allergy'
        })).toEqual({
            publicValues: { nickname: 'Rocket' },
            privateValues: {
                birthDate: '2014-02-03',
                jerseySize: 'YM',
                medicalNote: 'Peanut allergy'
            }
        });
    });
});
