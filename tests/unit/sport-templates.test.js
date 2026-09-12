import { describe, expect, it } from 'vitest';
import { getSportStatTemplate, getSportTemplateOptions } from '../../js/sport-templates.js';

describe('sport stat templates', () => {
    it('keeps the classic baseball and softball templates unchanged', () => {
        expect(getSportStatTemplate('Baseball')).toMatchObject({
            name: 'Baseball Standard',
            baseType: 'Baseball',
            columns: ['AB', 'H', 'R', 'RBI', 'BB', 'FP']
        });
        expect(getSportStatTemplate('softball')).toMatchObject({
            name: 'Softball Standard',
            baseType: 'Softball',
            columns: ['AB', 'H', 'R', 'RBI', 'BB', 'FP']
        });
        expect(getSportStatTemplate('fastpitch')).toBeNull();
    });

    it('keeps existing basketball and soccer templates available', () => {
        expect(getSportTemplateOptions().map(template => template.sport)).toEqual([
            'Basketball',
            'Soccer',
            'Baseball',
            'Softball'
        ]);
    });
});
