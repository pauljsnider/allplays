import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
    buildRegistrationRosterDecision,
    buildRegistrationStatusUpdate,
    canTransitionRegistrationStatus,
    getRegistrationGuardianDrafts,
    getRegistrationPlayerDraft,
    matchesRegistrationReviewStatus,
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
        expect(summarizeRegistration({ ...registration, screeningRequired: true, screeningStatus: 'flagged', screeningProviderReference: 'ref-123' })).toMatchObject({
            status: 'pending',
            screeningStatus: 'flagged',
            playerName: 'Avery Lee',
            playerNumber: '12',
            guardianLabel: 'pat@example.com'
        });
    });

    it('matches registration review status filters', () => {
        expect(matchesRegistrationReviewStatus({ status: 'pending' }, 'pending')).toBe(true);
        expect(matchesRegistrationReviewStatus({ status: 'rejected' }, 'rejected')).toBe(true);
        expect(matchesRegistrationReviewStatus({ status: 'waitlisted' }, 'waitlisted')).toBe(true);
        expect(matchesRegistrationReviewStatus({ status: 'offer-extended' }, 'offer-extended')).toBe(true);
        expect(matchesRegistrationReviewStatus({ status: 'offer-accepted' }, 'offer-accepted')).toBe(true);
        expect(matchesRegistrationReviewStatus({ status: 'released' }, 'released')).toBe(true);
        expect(matchesRegistrationReviewStatus({ status: 'approved' }, 'enrolled')).toBe(true);
        expect(matchesRegistrationReviewStatus({ registrationApproved: true }, 'registration-approved')).toBe(true);
        expect(matchesRegistrationReviewStatus({ rosterApproved: true }, 'roster-approved')).toBe(true);
        expect(matchesRegistrationReviewStatus({ registrationApproved: true }, 'roster-approved')).toBe(false);
        expect(matchesRegistrationReviewStatus({ rosterApproved: true }, 'registration-approved')).toBe(false);
        expect(matchesRegistrationReviewStatus({ registrationApproved: false }, 'rejected')).toBe(true);
        expect(matchesRegistrationReviewStatus({ rosterApproved: false }, 'rejected')).toBe(true);
        expect(matchesRegistrationReviewStatus({ rosterApproved: false }, 'roster-approved')).toBe(false);
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
            status: 'enrolled',
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

    it('builds auditable waitlist status updates and rejects invalid transitions', () => {
        const now = new Date('2026-05-06T12:00:00.000Z');
        const update = buildRegistrationStatusUpdate({
            registration: { status: 'waitlisted' },
            status: 'offer-extended',
            reviewer: { userId: 'admin-1', email: 'admin@example.com' },
            now
        });

        expect(update).toMatchObject({
            status: 'offer-extended',
            activeWaitlistDemand: true,
            offerExtendedAt: now,
            offerExtendedBy: 'admin-1',
            waitlistStatusUpdatedByName: 'admin@example.com'
        });
        expect(buildRegistrationStatusUpdate({ registration: { status: 'offer-accepted' }, status: 'released', now })).toMatchObject({
            status: 'released',
            activeWaitlistDemand: false,
            releasedAt: now
        });
        expect(canTransitionRegistrationStatus('released', 'offer-accepted', { adminAction: true })).toBe(false);
        expect(() => buildRegistrationStatusUpdate({ registration: { status: 'released' }, status: 'offer-accepted', now })).toThrow(/Invalid registration status transition/);
    });

    it('records new roster players as new-player even after an id is assigned', () => {

        const decision = buildRegistrationRosterDecision({
            registration: {
                id: 'reg-2',
                formId: 'spring-2026',
                player: { playerName: 'Riley Cruz' }
            },
            team: { id: 'team-1', name: 'Blue Jays' },
            playerId: 'generated-player-id',
            rosterDestinationType: 'new-player'
        });

        expect(decision.registrationUpdate.rosterDestination).toMatchObject({
            teamId: 'team-1',
            playerId: 'generated-player-id',
            type: 'new-player'
        });
    });

    it('wires roster registration review to admin-only screening updates', () => {
        const editRosterPage = fs.readFileSync('edit-roster.html', 'utf8');

        expect(editRosterPage).toContain('Manual screening');
        expect(editRosterPage).toContain('screening-status-select');
        expect(editRosterPage).toContain('screening-provider-reference');
        expect(editRosterPage).toContain('updateRegistrationScreening');
        expect(editRosterPage).toContain('screeningUpdatedByName');
    });

});
