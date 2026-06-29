import { describe, expect, it } from 'vitest';
import {
    buildRosterFieldDefinitionPayload,
    getRosterProfileValues,
    normalizeRosterFieldDefinitions,
    splitRosterProfileValuesByVisibility,
    validateRosterProfileValues
} from '../../js/roster-profile-fields.js';

describe('roster profile fields', () => {
    it('normalizes supported configured field shapes in display order', () => {
        const fields = normalizeRosterFieldDefinitions([
            { id: 'gradYear', label: 'Graduation Year', type: 'select', options: ['2028', { value: '2029', label: 'Class of 2029' }], sortOrder: 2 },
            { key: 'waiver', name: 'Waiver Complete', type: 'boolean', required: true, order: 1 },
            { title: 'Birth Date', type: 'date', required: true, order: 3 }
        ]);

        expect(fields).toEqual([
            expect.objectContaining({ key: 'waiver', label: 'Waiver Complete', type: 'checkbox', required: true }),
            expect.objectContaining({ key: 'gradYear', label: 'Graduation Year', type: 'menu', options: [
                { value: '2028', label: '2028' },
                { value: '2029', label: 'Class of 2029' }
            ] }),
            expect.objectContaining({ key: 'birth-date', label: 'Birth Date', type: 'date', required: true })
        ]);
    });

    it('validates required text, menu, date, and checkbox values', () => {
        const fields = normalizeRosterFieldDefinitions([
            { key: 'nickname', label: 'Nickname', type: 'text', required: true },
            { key: 'position', label: 'Position', type: 'menu', required: true },
            { key: 'birthDate', label: 'Birth Date', type: 'date', required: true },
            { key: 'waiver', label: 'Waiver Complete', type: 'checkbox', required: true }
        ]);

        expect(validateRosterProfileValues(fields, {
            nickname: 'Sam',
            position: 'Guard',
            birthDate: '2012-04-30',
            waiver: true
        })).toEqual([]);

        expect(validateRosterProfileValues(fields, {
            nickname: ' ',
            position: '',
            birthDate: null,
            waiver: false
        })).toEqual([
            'Nickname is required.',
            'Position is required.',
            'Birth Date is required.',
            'Waiver Complete is required.'
        ]);
    });

    it('loads existing custom field values from all persisted roster profile shapes', () => {
        expect(getRosterProfileValues({ profile: { customFields: { position: 'Guard' } } })).toEqual({ position: 'Guard' });
        expect(getRosterProfileValues({ customFields: { position: 'Forward' } })).toEqual({ position: 'Forward' });
        expect(getRosterProfileValues({ rosterFieldValues: { grade: '6' } })).toEqual({ grade: '6' });
    });

    it('uses editable profile custom fields over imported roster field values', () => {
        expect(getRosterProfileValues({
            rosterFieldValues: { grade: '6', position: 'Forward' },
            profile: { customFields: { position: 'Guard' } }
        })).toEqual({ grade: '6', position: 'Guard' });
    });

    it('builds persisted roster field definitions with visibility and menu options', () => {
        expect(buildRosterFieldDefinitionPayload({
            label: 'Jersey Size',
            type: 'menu',
            options: ['Youth M', 'Adult S'],
            section: 'Uniform',
            required: true,
            defaultVisibility: 'parents',
            sortOrder: 3
        })).toEqual({
            key: 'jersey-size',
            label: 'Jersey Size',
            type: 'menu',
            section: 'Uniform',
            required: true,
            options: [
                { value: 'Youth M', label: 'Youth M' },
                { value: 'Adult S', label: 'Adult S' }
            ],
            description: '',
            visibility: 'parents',
            active: true,
            sortOrder: 3
        });
    });

    it('stores only public and parent-readable private roster field values', () => {
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
                jerseySize: 'YM'
            }
        });
    });

    it('defaults unspecified roster field visibility to private team storage', () => {
        const fields = normalizeRosterFieldDefinitions([
            { key: 'grade', label: 'Grade' }
        ]);

        expect(splitRosterProfileValuesByVisibility(fields, { grade: '6' })).toEqual({
            publicValues: {},
            privateValues: { grade: '6' }
        });
    });

    it('excludes disabled definitions from player forms unless requested', () => {
        const fields = [
            { key: 'active', label: 'Active Field', type: 'text', active: true, sortOrder: 1 },
            { key: 'disabled', label: 'Disabled Field', type: 'text', active: false, sortOrder: 2 }
        ];

        expect(normalizeRosterFieldDefinitions(fields).map((field) => field.key)).toEqual(['active']);
        expect(normalizeRosterFieldDefinitions(fields, { includeInactive: true }).map((field) => field.key)).toEqual(['active', 'disabled']);
    });
});
