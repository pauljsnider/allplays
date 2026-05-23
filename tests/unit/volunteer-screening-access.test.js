import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
    VOLUNTEER_SCREENING_BLOCK_MESSAGE,
    assertVolunteerScreeningCleared,
    findBlockingVolunteerScreeningRegistration,
    registrationRequiresVolunteerScreening
} from '../../js/volunteer-screening-access.js';

describe('volunteer screening access guard', () => {
    it('blocks volunteer or staff grants when a related screening is not cleared', () => {
        const registrations = [
            {
                id: 'reg-1',
                programName: 'Spring Volunteers',
                guardian: { email: 'helper@example.com' },
                requiresScreening: true,
                screeningStatus: 'pending'
            }
        ];

        expect(findBlockingVolunteerScreeningRegistration(registrations, { email: 'Helper@Example.com' })).toMatchObject({
            id: 'reg-1'
        });
        expect(() => assertVolunteerScreeningCleared(registrations, { email: 'helper@example.com' })).toThrow(
            `${VOLUNTEER_SCREENING_BLOCK_MESSAGE} Related registration: Spring Volunteers.`
        );
    });

    it('allows cleared, player-only, unrelated, and non-screening registrations through', () => {
        const registrations = [
            { id: 'cleared', userId: 'user-1', requiresScreening: true, screeningStatus: 'cleared' },
            { id: 'player-only', userId: 'user-1', status: 'approved' },
            { id: 'other-user', userId: 'user-2', requiresScreening: true, screeningStatus: 'pending' },
            { id: 'legacy-form', guardian: { email: 'user@example.com' }, requiresScreening: false, screeningStatus: 'pending' }
        ];

        expect(findBlockingVolunteerScreeningRegistration(registrations, { userId: 'user-1', email: 'user@example.com' })).toBeNull();
        expect(assertVolunteerScreeningCleared(registrations, { userId: 'user-1', email: 'user@example.com' })).toBeNull();
    });

    it('recognizes bounded screening-required shapes from registration records', () => {
        expect(registrationRequiresVolunteerScreening({ screening: { required: true } })).toBe(true);
        expect(registrationRequiresVolunteerScreening({ backgroundCheck: { required: true } })).toBe(true);
        expect(registrationRequiresVolunteerScreening({ volunteerScreeningRequired: true })).toBe(true);
        expect(registrationRequiresVolunteerScreening({ participant: { name: 'Player' } })).toBe(false);
    });

    it('wires role grant actions through the screening guard', () => {
        const dbSource = fs.readFileSync('js/db.js', 'utf8');

        expect(dbSource).toContain("import { assertVolunteerScreeningCleared } from './volunteer-screening-access.js?v=1';");
        expect(dbSource).toContain('await assertVolunteerScreeningClearedForTeamGrant(teamId, { userId: normalizedUserId });');
        expect(dbSource).toContain('await assertVolunteerScreeningClearedForTeamGrant(teamId, { email: normalizedEmail });');
        expect(dbSource).toContain('function assertVolunteerScreeningClearedForTeamGrant');
    });
});
