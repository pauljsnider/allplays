import { describe, expect, it } from 'vitest';

import {
    getDefaultStatConfigForSport,
    getStatConfigPresetById,
    getStatConfigPresetOptions,
    serializeAdvancedStatDefinitions
} from '../../js/stat-config-presets.js';

describe('stat config presets', () => {
    it('exposes a reusable preset catalog beyond basketball and soccer', () => {
        const options = getStatConfigPresetOptions();
        const ids = options.map((option) => option.id);

        expect(ids).toEqual(expect.arrayContaining([
            'blank',
            'basketball',
            'soccer',
            'baseball',
            'football',
            'volleyball'
        ]));
        expect(options.length).toBeGreaterThan(4);
    });

    it('returns a normalized reusable config for a supported sport', () => {
        const preset = getDefaultStatConfigForSport('Soccer');

        expect(preset).toEqual(expect.objectContaining({
            name: 'Soccer Standard',
            baseType: 'Soccer',
            columns: expect.arrayContaining(['GOALS', 'SHOTS', 'SHOTS_ON_TARGET', 'ASSISTS'])
        }));
        expect(preset.statDefinitions).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'goals', label: 'GOALS', type: 'base' }),
            expect.objectContaining({ id: 'shotpct', label: 'Shot%', type: 'derived', topStat: true })
        ]));
    });

    it('can load a blank-slate preset for manual schema setup', () => {
        const preset = getStatConfigPresetById('blank');

        expect(preset).toEqual(expect.objectContaining({
            name: 'Custom Stat Schema',
            baseType: 'Custom',
            columns: []
        }));
        expect(preset.statDefinitions).toEqual([]);
    });

    it('serializes editable stat definitions for reload into the config form', () => {
        const text = serializeAdvancedStatDefinitions({
            columns: ['PTS', 'AST', 'TO'],
            statDefinitions: [
                { label: 'PTS', acronym: 'PTS', group: 'Offense', topStat: true },
                { label: 'AST', acronym: 'AST' },
                { label: 'TO', acronym: 'TO', rankingOrder: 'asc' },
                { id: 'asttoratio', label: 'AST/TO', acronym: 'AST/TO', formula: 'AST/TO', group: 'Offense', precision: 2, topStat: true }
            ]
        });

        expect(text.split('\n')).toEqual([
            'PTS=pts|group=Offense|topStat=true',
            'TO=to|rankingOrder=asc',
            'AST/TO=asttoratio|formula=AST/TO|group=Offense|precision=2|topStat=true'
        ]);
    });
});
