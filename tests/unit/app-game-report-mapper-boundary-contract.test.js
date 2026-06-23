import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const serviceSource = readFileSync(new URL('../../apps/app/src/lib/gameReportService.ts', import.meta.url), 'utf8');
const mapperSource = readFileSync(new URL('../../apps/app/src/lib/firestore/mappers.ts', import.meta.url), 'utf8');
const typeSource = readFileSync(new URL('../../apps/app/src/lib/firestore/types.ts', import.meta.url), 'utf8');

describe('game report Firestore mapper boundary', () => {
    it('routes report assembly through typed Firestore mappers instead of raw records', () => {
        expect(serviceSource).toContain("from './firestore/mappers'");
        [
            'mapGameReportTeamRecord',
            'mapGameReportGameRecord',
            'mapGameReportPlayerRecords',
            'mapGameReportAggregatedStatsRecord',
            'mapGameReportTeamStatsRecord',
            'mapGameReportEventRecords'
        ].forEach((mapperName) => {
            expect(serviceSource).toContain(mapperName);
            expect(mapperSource).toContain(`export function ${mapperName}`);
        });
        expect(mapperSource).toContain('export function mapGameReportOpponentStatsRecord');
    });

    it('keeps the report service typed to normalized mapper records', () => {
        [
            'GameReportTeamFirestoreRecord',
            'GameReportGameFirestoreRecord',
            'GameReportPlayerFirestoreRecord',
            'GameReportStatsRecord',
            'GameReportTeamStatsFirestoreRecord',
            'GameReportEventFirestoreRecord'
        ].forEach((typeName) => {
            expect(serviceSource).toContain(typeName);
            expect(typeSource).toContain(`export type ${typeName}`);
        });
        expect(typeSource).toContain('export type GameReportOpponentFirestoreRecord');
    });
});
