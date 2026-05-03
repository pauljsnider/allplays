import { describe, expect, it } from 'vitest';
import {
    getRosterProfileValues,
    normalizeRosterFieldDefinitions,
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

    it('loads existing custom field values from the structured profile object', () => {
        expect(getRosterProfileValues({ profile: { customFields: { position: 'Guard' } } })).toEqual({ position: 'Guard' });
        expect(getRosterProfileValues({ customFields: { position: 'Forward' } })).toEqual({ position: 'Forward' });
    });
});
