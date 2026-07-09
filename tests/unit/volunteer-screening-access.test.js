import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import {
    VOLUNTEER_SCREENING_BLOCK_MESSAGE,
    assertVolunteerScreeningCleared,
    buildVolunteerScreeningTargetQueries,
    findBlockingVolunteerScreeningRegistration,
    loadVolunteerScreeningTargetRegistrations,
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
        expect(registrationRequiresVolunteerScreening({
            source: 'public-registration',
            programName: 'Spring Volunteer Staff',
            participant: { name: 'Helper' }
        })).toBe(true);
        expect(registrationRequiresVolunteerScreening({
            source: 'public-registration',
            programName: 'Spring League',
            selectedOption: { title: 'Scorekeeper crew' },
            participant: { name: 'Helper' }
        })).toBe(true);
        expect(registrationRequiresVolunteerScreening({
            source: 'public-registration',
            programName: 'Player registration',
            selectedOption: { title: 'U10 player' },
            participant: { name: 'Player' }
        })).toBe(false);
        expect(registrationRequiresVolunteerScreening({ participant: { name: 'Player' } })).toBe(false);
    });

    it('builds a fixed set of target-specific registration lookups and deduplicates matched records', async () => {
        const querySpecs = buildVolunteerScreeningTargetQueries({
            userId: 'user-1',
            email: 'Helper@Example.com'
        });

        expect(querySpecs).toHaveLength(15);
        expect(querySpecs).toEqual(expect.arrayContaining([
            { fieldPath: 'userId', value: 'user-1' },
            { fieldPath: 'guardian.userId', value: 'user-1' },
            { fieldPath: 'email', value: 'helper@example.com' },
            { fieldPath: 'guardian.email', value: 'helper@example.com' }
        ]));

        const loadMatches = vi.fn(async ({ fieldPath, value }) => {
            if (fieldPath === 'userId') {
                return [{ id: 'reg-1', formId: 'form-1', programName: 'Spring Volunteers', refPath: 'teams/team-1/registrationForms/form-1/registrations/reg-1' }];
            }
            if (fieldPath === 'guardian.email') {
                return [{ id: 'reg-1', formId: 'form-1', programName: 'Spring Volunteers', refPath: 'teams/team-1/registrationForms/form-1/registrations/reg-1' }];
            }
            if (fieldPath === 'email') {
                return [{ id: 'reg-2', formId: 'form-2', programName: 'Summer Staff', refPath: 'teams/team-1/registrationForms/form-2/registrations/reg-2', email: value }];
            }
            return [];
        });

        const registrations = await loadVolunteerScreeningTargetRegistrations({
            userId: 'user-1',
            email: 'Helper@Example.com'
        }, loadMatches);

        expect(loadMatches).toHaveBeenCalledTimes(querySpecs.length);
        expect(registrations).toEqual([
            { id: 'reg-1', formId: 'form-1', programName: 'Spring Volunteers', refPath: 'teams/team-1/registrationForms/form-1/registrations/reg-1' },
            { id: 'reg-2', formId: 'form-2', programName: 'Summer Staff', refPath: 'teams/team-1/registrationForms/form-2/registrations/reg-2', email: 'helper@example.com' }
        ]);
        expect(() => assertVolunteerScreeningCleared([
            {
                ...registrations[0],
                userId: 'user-1',
                requiresScreening: true,
                screeningStatus: 'pending'
            },
            {
                ...registrations[0],
                userId: 'user-1',
                requiresScreening: true,
                screeningStatus: 'pending'
            }
        ], { userId: 'user-1' })).toThrow(`${VOLUNTEER_SCREENING_BLOCK_MESSAGE} Related registration: Spring Volunteers.`);
    });

    it('wires role grant actions through bounded target-specific screening lookups', () => {
        const dbSource = fs.readFileSync('js/db.js', 'utf8');

        expect(dbSource).toContain('assertVolunteerScreeningCleared,');
        expect(dbSource).toContain('loadVolunteerScreeningTargetRegistrations');
        expect(dbSource).toContain('await assertVolunteerScreeningClearedForTeamGrant(teamId, { userId: normalizedUserId });');
        expect(dbSource).toContain('await assertVolunteerScreeningClearedForTeamGrant(teamId, { email: normalizedEmail });');
        expect(dbSource).toContain('function assertVolunteerScreeningClearedForTeamGrant');
        expect(dbSource).toContain('async function listVolunteerScreeningRegistrationsForTeamGrantTarget(teamId, target = {})');
        expect(dbSource).toContain('return loadVolunteerScreeningTargetRegistrations(target, async ({ fieldPath, value }) => {');
        expect(dbSource).toContain('const forms = await loadForms();');
        expect(dbSource).toContain("where(fieldPath, '==', value)");
        expect(dbSource).toContain('getDocs(query(registrationsRef, where(fieldPath, \'==\', value)))');
        expect(dbSource).toContain('const registrations = await listVolunteerScreeningRegistrationsForTeamGrantTarget(teamId, normalizedTarget);');
        expect(dbSource).not.toContain('async function listVolunteerScreeningRegistrationsForTeam(teamId)');
        expect(dbSource).not.toContain('getDocs(collection(db, `teams/${normalizedTeamId}/registrationForms/${formId}/registrations`))');
        expect(dbSource).toContain("console.error('Failed to access registration records for volunteer screening:', error);");
    });

    it('keeps every staff grant path behind the target-filtered registration query contract', () => {
        const dbSource = fs.readFileSync('js/db.js', 'utf8');
        const guardCall = 'await assertVolunteerScreeningClearedForTeamGrant(teamId,';

        ['grantScorekeeperAccess', 'grantVideographerAccess', 'grantStreamScoreAccess', 'addTeamAdminEmail'].forEach((functionName) => {
            const start = dbSource.indexOf(`export async function ${functionName}`);
            expect(start, `${functionName} should be exported`).toBeGreaterThan(-1);
            const nextExport = dbSource.indexOf('\nexport async function ', start + 1);
            const functionSource = dbSource.slice(start, nextExport === -1 ? undefined : nextExport);
            expect(functionSource).toContain(guardCall);
        });

        const screeningLoaderStart = dbSource.indexOf('async function listVolunteerScreeningRegistrationsForTeamGrantTarget');
        const screeningLoaderEnd = dbSource.indexOf('\n\nasync function assertVolunteerScreeningClearedForTeamGrant', screeningLoaderStart);
        const screeningLoaderSource = dbSource.slice(screeningLoaderStart, screeningLoaderEnd);
        expect(screeningLoaderSource).toContain('getDocs(query(registrationsRef, where(fieldPath, \'==\', value)))');
        expect(screeningLoaderSource).not.toContain('getDocs(collection(db, `teams/${normalizedTeamId}/registrationForms/${formId}/registrations`))');
    });
});
