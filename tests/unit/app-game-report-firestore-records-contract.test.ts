import { describe, expect, it } from 'vitest';

import {
    mapGameReportEventRecord,
    mapGameReportGameRecord,
    mapGameReportPlayerRecords,
    mapGameReportTeamRecord
} from '../../apps/app/src/lib/firestore/mappers.ts';

describe('game report Firestore record boundary', () => {
    it('normalizes sparse game and team records with fallback ids', () => {
        expect(mapGameReportTeamRecord(null, 'team-1')).toEqual({
            id: 'team-1',
            name: null,
            sport: null
        });

        expect(mapGameReportGameRecord({
            id: ' ',
            summary: '  Post-game notes  ',
            statSheetPhotoUrl: ' https://img.example.test/sheet.png ',
            opponentStats: null
        }, 'game-1')).toMatchObject({
            id: 'game-1',
            summary: 'Post-game notes',
            statSheetPhotoUrl: 'https://img.example.test/sheet.png',
            opponentStats: {}
        });
    });

    it('drops player records without stable ids and trims display fields', () => {
        expect(mapGameReportPlayerRecords([
            { id: ' player-1 ', name: ' Ava ', number: ' 9 ', photoUrl: ' https://img.example.test/ava.jpg ' },
            { playerId: 'legacy-but-not-id', name: 'Missing stable id' },
            null,
            'bad row'
        ])).toEqual([{
            id: 'player-1',
            name: 'Ava',
            number: '9',
            photoUrl: 'https://img.example.test/ava.jpg'
        }]);
    });

    it('defaults event timeline records without leaking malformed rows', () => {
        expect(mapGameReportEventRecord({
            id: ' event-1 ',
            message: ' ',
            period: ' ',
            gameTime: ' 04:32 ',
            timestamp: { seconds: 2, nanoseconds: 750000000 }
        })).toEqual(expect.objectContaining({
            id: 'event-1',
            text: 'Event logged',
            period: 'Q1',
            clock: '04:32',
            timestamp: new Date(2750)
        }));

        expect(mapGameReportEventRecord({ text: 'No id' }, '')).toBeNull();
    });
});
