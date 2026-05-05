import { describe, expect, it } from 'vitest';
import {
    buildRegistrationRosterDecision,
    getRegistrationGuardianDrafts,
    getRegistrationPlayerDraft,
    normalizeRegistrationStatus,
    summarizeRegistration
} from '../../js/registration-review.js';

describe('registration review helpers', () => {
    it('normalizes submitted player and guardian fields for review', () => {
        const registration = {
            status: 'submitted',
            submittedData: {
                athlete: {
                    firstName: 'Avery',
                    lastName: 'Lee',
                    jerseyNumber: '12',
                    customFields: {
                        waiver: true,
                        medicalInfo: 'do not copy'
                    }
                },
                guardians: [
                    { guardianName: 'Pat Lee', guardianEmail: 'Pat@example.com', relationship: 'Mother' },
                    { guardianName: 'Pat Lee Duplicate', guardianEmail: 'pat@example.com', relationship: 'Mother' }
                ]
            }
        };

        expect(normalizeRegistrationStatus(registration.status)).toBe('pending');
        expect(getRegistrationPlayerDraft(registration)).toEqual({
            name: 'Avery Lee',
            number: '12',
            active: true,
            rosterFieldValues: { waiver: true }
        });
        expect(getRegistrationGuardianDrafts(registration)).toEqual([
            { email: 'pat@example.com', name: 'Pat Lee', relation: 'Mother', phone: '' }
        ]);
        expect(summarizeRegistration(registration)).toMatchObject({
            status: 'pending',
            playerName: 'Avery Lee',
            playerNumber: '12',
            guardianLabel: 'pat@example.com'
        });
    });

    it('builds an auditable roster approval decision', () => {
        const now = new Date('2026-05-05T12:00:00.000Z');
        const decision = buildRegistrationRosterDecision({
            registration: {
                id: 'reg-1',
                formId: 'spring-2026',
                player: { playerName: 'Jordan Kim', number: '5' },
                parents: [{ name: 'Taylor Kim', email: 'taylor@example.com' }]
            },
            team: { id: 'team-1', name: 'Blue Jays' },
            playerId: 'player-1',
            reviewer: { userId: 'admin-1', email: 'admin@example.com' },
            now,
            decisionNote: 'Eligible for 10U roster'
        });

        expect(decision.player).toMatchObject({
            name: 'Jordan Kim',
            number: '5',
            active: true,
            registrationSource: {
                formId: 'spring-2026',
                registrationId: 'reg-1',
                status: 'approved',
                linkedAt: now
            }
        });
        expect(decision.guardians).toEqual([
            { email: 'taylor@example.com', name: 'Taylor Kim', relation: 'Guardian', phone: '' }
        ]);
        expect(decision.registrationUpdate).toMatchObject({
            status: 'approved',
            linkedTeamId: 'team-1',
            linkedTeamName: 'Blue Jays',
            linkedPlayerId: 'player-1',
            decidedBy: 'admin-1',
            decidedByName: 'admin@example.com',
            decisionNote: 'Eligible for 10U roster',
            rosterDestination: {
                teamId: 'team-1',
                playerId: 'player-1',
                type: 'existing-player'
            }
        });
    });
});
