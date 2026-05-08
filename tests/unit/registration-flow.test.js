import { describe, expect, it } from 'vitest';
import {
    buildPendingRegistrationRecord,
    collectFieldValues,
    decideRegistrationPlacement,
    formatFeeAmount,
    normalizeRegistrationForm,
    validateRegistrationSubmission
} from '../../js/registration-flow.js';
import fs from 'node:fs';

describe('public registration flow', () => {
    it('normalizes a published form with participant, guardian, fee, and waiver details', () => {
        const form = normalizeRegistrationForm({
            name: 'Spring Soccer',
            season: 'Spring 2026',
            feeAmountCents: 12500,
            playerFields: [{ key: 'firstName', name: 'First name', required: true }],
            guardianFields: [{ id: 'email', label: 'Email', type: 'email', required: true }],
            waiver: 'I accept the risk.',
            status: 'published'
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(form).toMatchObject({
            id: 'form-1',
            teamId: 'team-1',
            programName: 'Spring Soccer',
            season: 'Spring 2026',
            feeAmountCents: 12500,
            published: true,
            waiverText: 'I accept the risk.'
        });
        expect(form.participantFields[0]).toMatchObject({ id: 'firstName', label: 'First name', required: true });
        expect(form.guardianFields[0]).toMatchObject({ id: 'email', type: 'email' });
        expect(formatFeeAmount(form.feeAmountCents, form.currency)).toBe('$125.00');
    });

    it('requires published state, required fields, and explicit waiver acceptance', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            participantFields: [{ id: 'playerName', label: 'Player name', required: true }],
            guardianFields: [{ id: 'guardianEmail', label: 'Guardian email', required: true }],
            waiverText: 'Waiver'
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(validateRegistrationSubmission(form, {
            participant: { playerName: '' },
            guardian: { guardianEmail: 'parent@example.com' },
            waiverAccepted: false
        })).toEqual([
            'Participant Player name is required.',
            'Waiver acceptance is required.'
        ]);

        expect(validateRegistrationSubmission(form, {
            participant: { playerName: 'Sam' },
            guardian: { guardianEmail: 'parent@example.com' },
            waiverAccepted: true
        })).toEqual([]);
    });

    it('builds a pending registration record for unauthenticated submission', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            feeAmountCents: 5000,
            published: true,
            waiverText: 'Waiver'
        }, { teamId: 'team-1', formId: 'form-1' });
        const now = { sentinel: 'serverTimestamp' };

        expect(buildPendingRegistrationRecord({
            form,
            participant: collectFieldValues([{ id: 'playerName' }], { playerName: ' Sam ' }),
            guardian: collectFieldValues([{ id: 'email' }], { email: ' parent@example.com ' }),
            waiverAccepted: true,
            now
        })).toEqual({
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Clinic',
            feeAmountCents: 5000,
            currency: 'USD',
            participant: { playerName: 'Sam' },
            guardian: { email: 'parent@example.com' },
            waiverAccepted: true,
            waiverText: 'Waiver',
            status: 'pending',
            submittedAt: now,
            source: 'public-registration'
        });
    });

    it('requires an active registration option when configured', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            registrationOptions: [
                { id: 'u10', title: 'U10', capacityLimit: 2, waitlistEnabled: true },
                { id: 'archived', title: 'Archived', active: false }
            ]
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(form.registrationOptions[0]).toMatchObject({
            id: 'u10',
            countKey: 'u10',
            title: 'U10',
            capacityLimit: 2,
            waitlistEnabled: true,
            active: true
        });
        expect(validateRegistrationSubmission(form, { waiverAccepted: true })).toEqual([
            'Please select a registration option.'
        ]);
        expect(validateRegistrationSubmission(form, { waiverAccepted: true, selectedOptionId: 'u10' })).toEqual([]);
    });

    it('places selected option registrations into pending, waitlisted, or blocked states', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            registrationOptions: [
                { id: 'u10', title: 'U10', capacityLimit: 2, waitlistEnabled: true },
                { id: 'u12', title: 'U12', capacityLimit: 1, waitlistEnabled: false }
            ]
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(decideRegistrationPlacement({
            form,
            selectedOptionId: 'u10',
            counts: { u10: { enrolled: 1, waitlisted: 0 } }
        })).toMatchObject({
            status: 'pending',
            nextCounts: { enrolled: 2, waitlisted: 0 }
        });

        expect(decideRegistrationPlacement({
            form,
            selectedOptionId: 'u10',
            counts: { u10: { enrolled: 2, waitlisted: 0 } }
        })).toMatchObject({
            status: 'waitlisted',
            nextCounts: { enrolled: 2, waitlisted: 1 }
        });

        expect(decideRegistrationPlacement({
            form,
            selectedOptionId: 'u12',
            counts: { u12: { enrolled: 1, waitlisted: 0 } }
        })).toMatchObject({
            status: 'blocked',
            reason: 'option-full',
            message: 'U12 is full and is not accepting waitlist registrations.'
        });
    });

    it('includes selected option metadata and waitlist lifecycle fields on records', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            feeAmountCents: 5000,
            published: true,
            registrationOptions: [{ id: 'u10', title: 'U10', capacityLimit: 1, waitlistEnabled: true }]
        }, { teamId: 'team-1', formId: 'form-1' });
        const now = { sentinel: 'serverTimestamp' };

        expect(buildPendingRegistrationRecord({
            form,
            participant: {},
            guardian: {},
            waiverAccepted: true,
            selectedOption: form.registrationOptions[0],
            status: 'waitlisted',
            now
        })).toMatchObject({
            status: 'waitlisted',
            waitlistedAt: now,
            selectedOption: {
                id: 'u10',
                title: 'U10',
                feeAmountCents: 5000,
                capacityLimit: 1,
                waitlistEnabled: true
            }
        });
    });

    it('wires registration page to public form reads and pending registration writes', () => {
        const page = fs.readFileSync('registration.html', 'utf8');
        expect(page).toContain("doc(db, 'teams', teamId, 'registrationForms', formId)");
        expect(page).toContain("collection(db, 'teams', teamId, 'registrationForms', formId, 'registrations')");
        expect(page).toContain('registration-options-section');
        expect(page).toContain('runTransaction(db, async (transaction)');
        expect(page).toContain('decideRegistrationPlacement');
        expect(page).toContain('option-full');
        expect(page).toContain('waiver-accepted');
        expect(page).toContain('confirmation-message');
        expect(page).toContain('labelText.textContent = field.label');
        expect(page).toContain("requiredMark.textContent = ' *'");

        const rules = fs.readFileSync('firestore.rules', 'utf8');
        expect(rules).toContain('match /registrationForms/{formId}');
        expect(rules).toContain('allow create: if (');
        expect(rules).toContain('isPublishedRegistrationForm(get(/databases/$(database)/documents/teams/$(teamId)/registrationForms/$(formId)).data)');
        expect(rules).toContain("data.status in ['pending', 'waitlisted']");
        expect(rules).toContain("'selectedOption'");
        expect(rules).toContain('isPublicRegistrationCapacityCounterUpdate');
        expect(rules).toContain("affectedKeys().hasOnly(['registrationOptionCounts', 'updatedAt'])");
        expect(rules).toContain('data.waiverAccepted == true');
        expect(rules).toContain('hasOnlyFlatStringValues(data.participant)');
        expect(rules).toContain('hasOnlyFlatStringValues(data.guardian)');
        expect(rules).toContain('data.keys().size() <= 20');
    });
});
