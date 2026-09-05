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
            'softball',
            'fastpitch',
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

    it('matches the advertised diamond sport stat templates', () => {
        const expectedColumns = ['AB', 'H', 'R', 'RBI', 'BB', 'FP'];

        const baseball = getDefaultStatConfigForSport('Baseball');
        const softball = getDefaultStatConfigForSport('softball');
        const fastpitch = getDefaultStatConfigForSport('fastpitch');

        expect(baseball).toEqual(expect.objectContaining({
            name: 'Baseball Standard',
            baseType: 'Baseball',
            columns: expectedColumns,
            statDefinitions: expect.arrayContaining([
                expect.objectContaining({ id: 'ab', label: 'AB', group: 'Batting' }),
                expect.objectContaining({ id: 'bb', label: 'BB', group: 'Plate Discipline', topStat: true }),
                expect.objectContaining({ id: 'fp', label: 'FP', group: 'Fielding', type: 'base', format: 'number', precision: 0, topStat: true })
            ])
        }));
        expect(baseball.statDefinitions).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'pa', group: 'Batting', type: 'base' }),
            expect.objectContaining({ id: 'avg', group: 'Batting Rates', type: 'derived', precision: 3 }),
            expect.objectContaining({ id: 'sb', group: 'Baserunning', type: 'base' }),
            expect.objectContaining({ id: 'ip_outs', group: 'Pitching', type: 'base' }),
            expect.objectContaining({ id: 'era', group: 'Pitching Rates', type: 'derived', precision: 2, rankingOrder: 'asc' }),
            expect.objectContaining({ id: 'fpct', group: 'Fielding Rates', type: 'derived', precision: 3 })
        ]));
        expect(baseball.statDefinitions.length).toBeGreaterThan(60);
        expect(softball).toEqual(expect.objectContaining({
            name: 'Softball Standard',
            baseType: 'Softball',
            columns: expectedColumns,
            statDefinitions: expect.arrayContaining([
                expect.objectContaining({ id: 'ab', label: 'AB', group: 'Batting' }),
                expect.objectContaining({ id: 'bb', label: 'BB', group: 'Plate Discipline', topStat: true }),
                expect.objectContaining({ id: 'fp', label: 'FP', group: 'Fielding', type: 'base', format: 'number', precision: 0, topStat: true })
            ])
        }));
        expect(fastpitch).toEqual(expect.objectContaining({
            name: 'Fastpitch Standard',
            baseType: 'Fastpitch',
            columns: expectedColumns
        }));
        expect(fastpitch.statDefinitions).toEqual(baseball.statDefinitions.map((definition) => ({ ...definition })));

        // The established generic Softball preset remains deliberately small;
        // Diamond v2 uses the explicit Fastpitch contract above.
        expect(softball.statDefinitions).toHaveLength(6);

    });

    it('does not change non-Diamond preset defaults', () => {
        expect(getStatConfigPresetById('football')).toMatchObject({
            name: 'Football Standard',
            baseType: 'Football',
            columns: ['TD', 'YDS', 'TACK', 'SACK', 'TO']
        });
        expect(getStatConfigPresetById('volleyball')).toMatchObject({
            name: 'Volleyball Standard',
            baseType: 'Volleyball',
            columns: ['KILLS', 'AST', 'DIGS', 'ACES', 'BLKS']
        });
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
