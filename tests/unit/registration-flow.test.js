import { describe, expect, it } from 'vitest';
import {
    buildPendingRegistrationRecord,
    collectFieldValues,
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

    it('wires registration page to public form reads and pending registration writes', () => {
        const page = fs.readFileSync('registration.html', 'utf8');
        expect(page).toContain("doc(db, 'teams', teamId, 'registrationForms', formId)");
        expect(page).toContain("collection(db, 'teams', teamId, 'registrationForms', formId, 'registrations')");
        expect(page).toContain('waiver-accepted');
        expect(page).toContain('confirmation-message');

        const rules = fs.readFileSync('firestore.rules', 'utf8');
        expect(rules).toContain('match /registrationForms/{formId}');
        expect(rules).toContain('allow create: if isPublishedRegistrationForm');
        expect(rules).toContain("data.status == 'pending'");
        expect(rules).toContain('data.waiverAccepted == true');
    });
});
