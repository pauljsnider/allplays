import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { calculateSeasonRecord } from '../../js/season-record.js';
import {
    buildSeasonRecordGameFields,
    hydrateSeasonRecordFormFields
} from '../../js/edit-schedule-season-record.js';

describe('edit schedule season record workflow', () => {
    it('keeps a saved tournament game excluded from the selected season record after reload', () => {
        const parsedGameDate = new Date('2026-06-14T18:00:00.000Z');
        const savedGameFields = buildSeasonRecordGameFields({
            parsedGameDate,
            seasonLabel: '2026',
            competitionType: 'tournament',
            countsTowardSeasonRecord: false
        });

        expect(savedGameFields).toEqual({
            seasonLabel: '2026',
            competitionType: 'tournament',
            countsTowardSeasonRecord: false
        });

        expect(hydrateSeasonRecordFormFields({
            game: {
                ...savedGameFields,
                date: parsedGameDate
            },
            fallbackDate: new Date('2026-06-01T12:00:00.000Z')
        })).toEqual({
            seasonLabel: '2026',
            competitionType: 'tournament',
            countsTowardSeasonRecord: false
        });

        const record = calculateSeasonRecord([
            {
                type: 'game',
                status: 'completed',
                homeScore: 4,
                awayScore: 2,
                ...savedGameFields
            }
        ], { seasonLabel: '2026' });

        expect(record).toEqual({ wins: 0, losses: 0, ties: 0 });
    });

    it('preserves an existing tournament exclusion on edit while league games in the same season still count', () => {
        const tournamentGame = {
            type: 'game',
            status: 'completed',
            homeScore: 3,
            awayScore: 1,
            date: new Date('2026-07-01T17:00:00.000Z'),
            seasonLabel: '2026',
            competitionType: 'tournament',
            countsTowardSeasonRecord: false
        };
        const hydratedFields = hydrateSeasonRecordFormFields({
            game: tournamentGame,
            fallbackDate: new Date('2026-07-01T17:00:00.000Z')
        });

        expect(hydratedFields).toEqual({
            seasonLabel: '2026',
            competitionType: 'tournament',
            countsTowardSeasonRecord: false
        });

        const editedTournamentFields = buildSeasonRecordGameFields({
            parsedGameDate: new Date('2026-07-01T17:00:00.000Z'),
            ...hydratedFields
        });
        const sameSeasonLeagueGame = buildSeasonRecordGameFields({
            parsedGameDate: new Date('2026-07-08T17:00:00.000Z'),
            seasonLabel: '2026',
            competitionType: 'league',
            countsTowardSeasonRecord: true
        });

        const record = calculateSeasonRecord([
            {
                ...tournamentGame,
                ...editedTournamentFields
            },
            {
                type: 'game',
                status: 'completed',
                homeScore: 2,
                awayScore: 0,
                date: new Date('2026-07-08T17:00:00.000Z'),
                ...sameSeasonLeagueGame
            }
        ], { seasonLabel: '2026' });

        expect(record).toEqual({ wins: 1, losses: 0, ties: 0 });
    });

    it('wires edit-schedule through the shared season-record helper', () => {
        const source = readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain("import { buildSeasonRecordGameFields, hydrateSeasonRecordFormFields } from './js/edit-schedule-season-record.js?v=1';");
        expect(source).toContain('const seasonRecordFields = hydrateSeasonRecordFormFields({');
        expect(source).toContain('const seasonRecordFields = buildSeasonRecordGameFields({');
        expect(source).toContain('...seasonRecordFields,');
    });
});
