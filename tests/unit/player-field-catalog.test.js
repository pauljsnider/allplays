import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    PLAYER_FIELD_CATALOG,
    getPlayerCatalogFieldKeys,
    normalizePlayerCatalogFields,
    resolvePlayerCatalogField
} from '../../js/player-field-catalog.js';

const SENSITIVE_FORBIDDEN = [
    'parents', 'parent', 'parentEmail', 'parentPhone', 'guardian', 'guardianEmail',
    'contacts', 'contact', 'emergencyContact', 'medicalInfo', 'medicalNotes', 'address'
];

describe('player field catalog', () => {
    it('contains only public non-sensitive keys', () => {
        const keys = getPlayerCatalogFieldKeys();
        SENSITIVE_FORBIDDEN.forEach((forbidden) => {
            expect(keys).not.toContain(forbidden);
        });
        expect(keys).toContain('position');
        expect(keys).toContain('dob');
    });

    it('resolves fields by key, label, and alias', () => {
        expect(resolvePlayerCatalogField('position')?.key).toBe('position');
        expect(resolvePlayerCatalogField('Date of birth')?.key).toBe('dob');
        expect(resolvePlayerCatalogField('nickname')?.key).toBe('preferredName');
        expect(resolvePlayerCatalogField('unknown-column')).toBeNull();
    });
});

describe('normalizePlayerCatalogFields', () => {
    it('keeps valid public fields and drops unknown keys', () => {
        const result = normalizePlayerCatalogFields({
            position: ' Point Guard ',
            grade: '7',
            somethingElse: 'ignored'
        });
        expect(result).toEqual({ position: 'Point Guard', grade: '7' });
    });

    it('validates dob as ISO YYYY-MM-DD and drops invalid dates', () => {
        expect(normalizePlayerCatalogFields({ dob: '2015-03-09' })).toEqual({ dob: '2015-03-09' });
        expect(normalizePlayerCatalogFields({ dob: '03/09/2015' })).toEqual({});
        expect(normalizePlayerCatalogFields({ dob: '2015-13-40' })).toEqual({});
    });

    it('constrains dominant hand/foot to left/right/both', () => {
        expect(normalizePlayerCatalogFields({ dominantHand: 'Left' })).toEqual({ dominantHand: 'left' });
        expect(normalizePlayerCatalogFields({ dominantFoot: 'sideways' })).toEqual({});
    });

    it('never lets a sensitive contact key through', () => {
        const result = normalizePlayerCatalogFields({
            parentEmail: 'dad@allplays.ai',
            medicalNotes: 'allergy',
            position: 'Forward'
        });
        expect(result).toEqual({ position: 'Forward' });
    });

    it('drops empty values', () => {
        expect(normalizePlayerCatalogFields({ position: '   ', school: '' })).toEqual({});
    });
});

describe('edit-roster AI import wiring', () => {
    const source = readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');

    it('imports and applies the catalog in the AI import', () => {
        expect(source).toContain("import { normalizePlayerCatalogFields, getPlayerCatalogFieldKeys } from './js/player-field-catalog.js");
        expect(source).toContain('...normalizePlayerCatalogFields(op.player)');
        expect(source).toContain('...normalizePlayerCatalogFields(op.changes)');
    });

    it('adds the string catalog fields to the AI response schema', () => {
        // heightInches is numeric and intentionally not part of the string-only AI schema.
        const schemaKeys = ['preferredName', 'position', 'dob', 'gender', 'grade', 'school', 'jerseySize', 'dominantHand', 'dominantFoot', 'memberId'];
        schemaKeys.forEach((key) => {
            expect(source).toContain(`${key}: Schema.string()`);
        });
    });
});
