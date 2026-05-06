import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
    buildAdminRegistrationFormPayload,
    getAdminRegistrationShareUrl,
    validateAdminRegistrationFormPayload
} from '../../js/admin-registration-forms.js';

describe('admin registration form setup', () => {
    it('builds draft and published form payloads with metadata, fields, waiver, and fee', () => {
        const payload = buildAdminRegistrationFormPayload({
            title: 'Spring Soccer',
            description: 'Season registration',
            programType: 'season',
            season: 'Spring 2026',
            feeAmount: '125.50',
            participantFieldsText: 'Player name\nBirthdate',
            guardianFieldsText: 'Guardian name, Guardian email, Guardian phone',
            waiverText: 'I accept the risk.',
            status: 'published'
        }, { teamId: 'team-1' });

        expect(payload).toMatchObject({
            teamId: 'team-1',
            programName: 'Spring Soccer',
            title: 'Spring Soccer',
            description: 'Season registration',
            programType: 'season',
            season: 'Spring 2026',
            feeAmountCents: 12550,
            currency: 'USD',
            waiverText: 'I accept the risk.',
            status: 'published',
            published: true
        });
        expect(payload.participantFields).toEqual([
            { id: 'participant_1', label: 'Player name', type: 'text', required: true, options: [] },
            { id: 'participant_2', label: 'Birthdate', type: 'date', required: true, options: [] }
        ]);
        expect(payload.guardianFields[1]).toMatchObject({ label: 'Guardian email', type: 'email', required: true });
        expect(validateAdminRegistrationFormPayload(payload)).toEqual([]);
    });

    it('keeps unpublished forms as drafts and validates required admin setup', () => {
        const payload = buildAdminRegistrationFormPayload({
            title: '',
            waiverText: '',
            status: 'draft'
        }, { teamId: 'team-1' });

        expect(payload.status).toBe('draft');
        expect(payload.published).toBe(false);
        expect(validateAdminRegistrationFormPayload(payload)).toEqual([
            'Title is required.',
            'Waiver text is required.'
        ]);
    });

    it('creates a shareable public registration URL for published forms', () => {
        expect(getAdminRegistrationShareUrl('team 1', 'form/2', 'https://allplays.example')).toBe(
            'https://allplays.example/registration.html?teamId=team%201&formId=form%2F2'
        );
    });

    it('wires the admin dashboard to create, edit, publish, and copy registration links', () => {
        const adminPage = fs.readFileSync('admin.html', 'utf8');
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminPage).toContain('registration-forms-modal');
        expect(adminPage).toContain('registration-participant-fields');
        expect(adminPage).toContain('registration-guardian-fields');
        expect(adminPage).toContain('registration-waiver');
        expect(adminPage).toContain('Publish and show link');
        expect(adminJs).toContain('window.openRegistrationFormsAdmin');
        expect(adminJs).toContain('teams/${activeRegistrationTeam.id}/registrationForms');
        expect(adminJs).toContain('setDoc(formRef');
        expect(adminJs).toContain('updateDoc(doc(db, `teams/${activeRegistrationTeam.id}/registrationForms`, formId)');
        expect(adminJs).toContain('copyRegistrationLinkAdmin');
    });
});
