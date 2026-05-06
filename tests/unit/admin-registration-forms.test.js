import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
    buildAdminRegistrationFormPayload,
    fieldLabelsToDefinitions,
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

    it('infers date inputs only from date-specific labels', () => {
        expect(fieldLabelsToDefinitions(['Birthdate', 'Start date', 'Update notes', 'Candidate info'])).toEqual([
            { id: 'field_1', label: 'Birthdate', type: 'date', required: true, options: [] },
            { id: 'field_2', label: 'Start date', type: 'date', required: true, options: [] },
            { id: 'field_3', label: 'Update notes', type: 'text', required: true, options: [] },
            { id: 'field_4', label: 'Candidate info', type: 'text', required: true, options: [] }
        ]);
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
        expect(adminJs).toContain('const teamId = activeRegistrationTeam.id;');
        expect(adminJs).toContain('if (activeRegistrationTeam?.id !== teamId) return;');
        expect(adminJs).toContain('teams/${teamId}/registrationForms');
        expect(adminJs).toContain('setDoc(formRef');
        expect(adminJs).toContain('updateDoc(doc(db, `teams/${teamId}/registrationForms`, formId)');
        expect(adminJs).toContain('try {');
        expect(adminJs).toContain('inlineJsString');
        expect(adminJs).toContain('copyRegistrationLinkAdmin');
    });
});
