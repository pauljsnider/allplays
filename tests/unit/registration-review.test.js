import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
    buildRegistrationReviewCsv,
    buildRegistrationReviewCsvFilename,
    buildRegistrationRosterDecision,
    getDefaultRegistrationReviewCsvColumnKeys,
    getRegistrationReviewCsvColumnDefinitions,
    buildRegistrationStatusUpdate,
    flattenRegistrationReviewForCsv,
    canTransitionRegistrationStatus,
    getRegistrationGuardianDrafts,
    getRegistrationPlayerDraft,
    matchesRegistrationReviewScreeningStatus,
    matchesRegistrationReviewStatus,
    normalizeRegistrationStatus,
    summarizeRegistrationReviewScreening,
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
                        medicalInfo: 'do not copy',
                        contacts: [{ email: 'private@example.com' }],
                        contactPhone: '555-1111'
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

    it('strips contact aliases from registration roster drafts before public player writes', () => {
        const registration = {
            submittedData: {
                athlete: {
                    firstName: 'Avery',
                    lastName: 'Lee',
                    customFields: {
                        waiver: true,
                        contacts: [{ name: 'Pat Lee', email: 'pat@example.com' }],
                        contactEmail: 'pat@example.com',
                        parentPhone: '555-1212',
                        guardianEmail: 'guardian@example.com',
                        householdContact: { name: 'Family Contact' }
                    }
                },
                rosterFieldValues: {
                    position: 'Guard',
                    contactPhone: '555-3434',
                    householdEmail: 'family@example.com'
                }
            }
        };

        expect(getRegistrationPlayerDraft(registration)).toEqual({
            name: 'Avery Lee',
            number: '',
            active: true,
            rosterFieldValues: { waiver: true, position: 'Guard' }
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

    it('summarizes volunteer screening counts for required registrations only', () => {
        const summary = summarizeRegistrationReviewScreening([
            { screeningRequired: true, screeningStatus: 'pending' },
            { screeningRequired: true, screeningStatus: 'submitted' },
            { screeningRequired: true, screeningStatus: 'cleared' },
            { screeningRequired: true, screeningStatus: 'flagged' },
            { screeningRequired: true, screeningStatus: 'expired' },
            { screeningRequired: true, screeningStatus: 'rejected' },
            { screeningRequired: true, screeningStatus: 'needs review' },
            { screeningRequired: false, screeningStatus: 'rejected' }
        ]);

        expect(summary.counts).toEqual({
            pending: 2,
            submitted: 1,
            cleared: 1,
            flagged: 1,
            expired: 1,
            rejected: 1
        });
        expect(summary.totalRequired).toBe(7);
        expect(summary.notCleared).toBe(6);
        expect(summary.statuses).toEqual(['pending', 'submitted', 'cleared', 'flagged', 'expired', 'rejected']);
    });

    it('matches volunteer screening status filters without changing registration status filters', () => {
        expect(matchesRegistrationReviewScreeningStatus({ screeningRequired: false }, 'all')).toBe(true);
        expect(matchesRegistrationReviewScreeningStatus({ screeningRequired: true, screeningStatus: 'Submitted' }, 'submitted')).toBe(true);
        expect(matchesRegistrationReviewScreeningStatus({ screeningRequired: true, screeningStatus: 'submitted' }, 'cleared')).toBe(false);
        expect(matchesRegistrationReviewScreeningStatus({ screeningRequired: false, screeningStatus: 'submitted' }, 'submitted')).toBe(false);
        expect(matchesRegistrationReviewScreeningStatus({ screeningRequired: true, screeningStatus: 'unknown' }, 'pending')).toBe(true);
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
        expect(canTransitionRegistrationStatus('offer-extended', 'offer-accepted', { adminAction: true })).toBe(true);
        expect(buildRegistrationStatusUpdate({
            registration: { status: 'offer-extended' },
            status: 'offer-accepted',
            reviewer: { userId: 'admin-1', email: 'admin@example.com' },
            now
        })).toMatchObject({
            status: 'offer-accepted',
            activeWaitlistDemand: true,
            offerAcceptedAt: now,
            offerAcceptedBy: 'admin-1',
            waitlistStatusUpdatedByName: 'admin@example.com'
        });
        expect(canTransitionRegistrationStatus('waitlisted', 'offer-accepted', { adminAction: true })).toBe(false);
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
        expect(editRosterPage).toContain('registration-screening-summary');
        expect(editRosterPage).toContain('registration-screening-status-filter');
        expect(editRosterPage).toContain('summarizeRegistrationReviewScreening');
        expect(editRosterPage).toContain('matchesRegistrationReviewScreeningStatus');
        expect(editRosterPage).toContain('screening-status-select');
        expect(editRosterPage).toContain('screening-provider-reference');
        expect(editRosterPage).toContain('updateRegistrationScreening');
        expect(editRosterPage).toContain('screeningUpdatedByName');
        expect(editRosterPage).toContain('registration-export-options');
        expect(editRosterPage).toContain('registration-export-columns');
        expect(editRosterPage).toContain('getRegistrationReviewCsvColumnDefinitions');
        expect(editRosterPage).toContain('acceptTeamRegistrationOffer');
        expect(editRosterPage).toContain('accept-offer-registration-btn');
        expect(editRosterPage).toContain('Mark accepted');
    });

    it('flattens registration reviews for CSV export', () => {
        const submittedAt = new Date('2026-05-23T12:00:00.000Z');
        const row = flattenRegistrationReviewForCsv({
            id: 'reg-1',
            status: 'offer accepted',
            submittedAt,
            submittedData: {
                athlete: { firstName: 'Avery', lastName: 'Lee', jerseyNumber: '12' },
                guardian: { guardianName: 'Pat Lee', guardianEmail: 'Pat@example.com' }
            },
            selectedOptionId: 'travel',
            feeSnapshot: { finalAmountDueCents: 12550, currency: 'usd' },
            paymentPlan: { label: 'Pay in full' },
            linkedPlayerId: 'player-1',
            decisionNote: 'Approved for roster'
        }, {
            registrationOptions: [{ id: 'travel', title: 'Travel Team' }]
        });

        expect(row).toEqual({
            registrationId: 'reg-1',
            playerName: 'Avery Lee',
            playerNumber: '12',
            guardianName: 'Pat Lee',
            guardianEmail: 'pat@example.com',
            status: 'offer-accepted',
            selectedOptionLabel: 'Travel Team',
            selectedOptionId: 'travel',
            submittedDate: '2026-05-23T12:00:00.000Z',
            feeAmount: '125.50 USD',
            paymentPlan: 'Pay in full',
            linkedPlayerId: 'player-1',
            decisionNote: 'Approved for roster'
        });
    });

    it('serializes registration review CSV with safe escaping', () => {
        const csv = buildRegistrationReviewCsv([{
            id: 'reg-2',
            status: 'pending',
            submittedData: {
                athlete: { name: 'Jordan, "JJ" Reed', jerseyNumber: '22' },
                guardian: { guardianName: 'Taylor\nReed', guardianEmail: 'taylor@example.com' }
            },
            selectedOption: { id: 'camp', title: 'Summer, Camp' },
            feeSnapshot: { finalAmountDueCents: 0, currency: 'usd' },
            paymentPlan: { label: 'Installments' },
            decisionNote: 'Needs "waiver"\nfollow-up'
        }]);

        expect(csv.split('\n')[0]).toBe('registration id,player name,player number,guardian name,guardian email,status,selected option label,selected option id,submitted date,fee amount,payment plan,linked player id,decision note');
        expect(csv).toContain('"Jordan, ""JJ"" Reed"');
        expect(csv).toContain('"Taylor\nReed"');
        expect(csv).toContain('"Summer, Camp"');
        expect(csv).toContain('"Needs ""waiver""\nfollow-up"');
    });

    it('serializes registration review CSV with selected standard columns', () => {
        const csv = buildRegistrationReviewCsv([{
            id: 'reg-4',
            status: 'enrolled',
            submittedData: {
                athlete: { name: 'Morgan West', jerseyNumber: '8' },
                guardian: { guardianName: 'Casey West', guardianEmail: 'casey@example.com' }
            },
            decisionNote: 'Ready for coach sheet'
        }], {}, ['playerName', 'status', 'decisionNote']);

        expect(csv.split('\n')).toEqual([
            'player name,status,decision note',
            'Morgan West,enrolled,Ready for coach sheet'
        ]);
    });

    it('serializes participant and guardian form fields as selectable CSV columns', () => {
        const form = {
            participantFields: [
                { id: 'birthdate', label: 'Birthdate' },
                { id: 'division', label: 'Division' }
            ],
            guardianFields: [
                { id: 'phone', label: 'Guardian phone' }
            ]
        };
        const definitions = getRegistrationReviewCsvColumnDefinitions(form);
        const csv = buildRegistrationReviewCsv([{
            id: 'reg-5',
            status: 'pending',
            submittedData: {
                participant: { birthdate: '2015-04-01', division: '10U' },
                guardian: { phone: '555-0100' }
            }
        }], form, ['participant.birthdate', 'guardian.phone', 'participant.division']);

        expect(getDefaultRegistrationReviewCsvColumnKeys()).toContain('registrationId');
        expect(definitions.map((definition) => definition.key)).toEqual(expect.arrayContaining([
            'participant.birthdate',
            'participant.division',
            'guardian.phone'
        ]));
        expect(csv.split('\n')).toEqual([
            'participant: Birthdate,guardian: Guardian phone,participant: Division',
            '2015-04-01,555-0100,10U'
        ]);
    });

    it('preserves falsy custom registration review CSV cell values', () => {
        const csv = buildRegistrationReviewCsv([{
            id: 'reg-7',
            status: 'pending',
            submittedData: {
                participant: { goals: 0 },
                guardian: { receivesTexts: false }
            }
        }], {
            participantFields: [{ id: 'goals', label: 'Goals' }],
            guardianFields: [{ id: 'receivesTexts', label: 'Receives texts' }]
        }, ['participant.goals', 'guardian.receivesTexts']);

        expect(csv.split('\n')).toEqual([
            'participant: Goals,guardian: Receives texts',
            '0,false'
        ]);
    });

    it('neutralizes spreadsheet formulas in custom registration review CSV cells', () => {
        const csv = buildRegistrationReviewCsv([{
            id: 'reg-6',
            status: 'pending',
            submittedData: {
                participant: { legalName: '=IMPORTXML("https://example.com","//x")' },
                guardian: { phone: '+15550100' }
            }
        }], {
            participantFields: [{ id: 'legalName', label: 'Legal name' }],
            guardianFields: [{ id: 'phone', label: 'Guardian phone' }]
        }, ['participant.legalName', 'guardian.phone']);

        expect(csv).toContain('"\'=IMPORTXML(""https://example.com"",""//x"")"');
        expect(csv).toContain("'+15550100");
    });

    it('neutralizes spreadsheet formulas in registration review CSV cells', () => {
        const csv = buildRegistrationReviewCsv([{
            id: 'reg-3',
            status: 'pending',
            submittedData: {
                athlete: { name: '=IMPORTXML("https://example.com","//x")', jerseyNumber: '+22' },
                guardian: { guardianName: '-Taylor Reed', guardianEmail: '@example.com' }
            },
            selectedOption: { id: 'camp', title: '=Summer Camp' },
            feeSnapshot: { finalAmountDueCents: 1000, currency: 'usd' },
            paymentPlan: { label: '-Installments' },
            decisionNote: '@follow-up'
        }]);

        expect(csv).toContain('"\'=IMPORTXML(""https://example.com"",""//x"")"');
        expect(csv).toContain("'+22");
        expect(csv).toContain("'-Taylor Reed");
        expect(csv).toContain("'@example.com");
        expect(csv).toContain("'=Summer Camp");
        expect(csv).toContain("'-Installments");
        expect(csv).toContain("'@follow-up");
    });

    it('builds deterministic registration review CSV filenames', () => {
        expect(buildRegistrationReviewCsvFilename({
            teamId: 'Team 1',
            formId: 'Spring Travel',
            status: 'offer accepted',
            now: new Date('2026-05-23T12:00:00.000Z')
        })).toBe('registration-review-team-1-spring-travel-offer-accepted-2026-05-23.csv');
    });
});
