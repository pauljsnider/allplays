import { describe, expect, it } from 'vitest';

import {
    mapChatConversationRecord,
    mapChatMessageRecord,
    mapFirestoreDocument,
    mapGameReportAggregatedStatsRecord,
    mapGameReportEventRecords,
    mapGameReportGameRecord,
    mapGameReportOpponentStatsRecord,
    mapGameReportPlayerRecords,
    mapGameReportTeamRecord,
    mapGameReportTeamStatsRecord,
    mapScheduleEventDocument,
    mapScheduleEventRecords
} from '../../apps/app/src/lib/firestore/mappers.ts';
import type { FirestoreDocument } from '../../apps/app/src/lib/firestore/types.ts';

describe('firestore mappers', () => {
    it('decodes native Firestore document values behind the data-access boundary', () => {
        const document: FirestoreDocument = {
            name: 'projects/allplays/databases/(default)/documents/teams/team-1/events/event-1',
            fields: {
                title: { stringValue: 'Game day' },
                cancelled: { booleanValue: false },
                expectedPlayers: { integerValue: '12' },
                score: { doubleValue: 8.5 },
                startsAt: { timestampValue: '2026-06-20T18:30:00.000Z' },
                tags: {
                    arrayValue: {
                        values: [
                            { stringValue: 'home' },
                            { stringValue: 'league' }
                        ]
                    }
                },
                metadata: {
                    mapValue: {
                        fields: {
                            source: { stringValue: 'native-firestore' },
                            imported: { nullValue: 'NULL_VALUE' }
                        }
                    }
                }
            }
        };

        expect(mapFirestoreDocument(document)).toEqual({
            id: 'event-1',
            title: 'Game day',
            cancelled: false,
            expectedPlayers: 12,
            score: 8.5,
            startsAt: new Date('2026-06-20T18:30:00.000Z'),
            tags: ['home', 'league'],
            metadata: {
                source: 'native-firestore',
                imported: null
            }
        });
    });

    it('normalizes chat conversations to typed ids, participants, and mute lists', () => {
        expect(mapChatConversationRecord({
            id: '',
            type: 'unsupported',
            participantIds: [' parent-1 ', '', 'parent-1', 'coach-1'],
            participantRoles: ['parent', 'parent', '', 'coach'],
            directAccess: 'accepted_friend',
            directUserIds: [' parent-1 ', 'coach-1', 'parent-1'],
            friendshipId: ' coach-1__parent-1 ',
            initiatedBy: ' parent-1 ',
            mutedBy: [' parent-1 ', 'parent-1', null],
            isDefault: true
        }, 'conversation-1')).toEqual({
            id: 'conversation-1',
            type: 'group',
            name: null,
            participantIds: ['parent-1', 'coach-1'],
            participantRoles: ['parent', 'coach'],
            directAccess: 'accepted_friend',
            directUserIds: ['parent-1', 'coach-1'],
            friendshipId: 'coach-1__parent-1',
            initiatedBy: 'parent-1',
            mutedBy: ['parent-1'],
            isDefault: true,
            isLegacy: false,
            updatedAt: null,
            lastMessageAt: null
        });
    });

    it('normalizes chat messages with attachments, reactions, and timestamps at the Firestore boundary', () => {
        const createdAt = { seconds: 1760965800, nanoseconds: 250000000 };
        const editedAt = { toMillis: () => 1760966100123 };

        expect(mapChatMessageRecord({
            id: '',
            clientMessageId: ' client-1 ',
            text: ' Team update ',
            senderId: ' coach-1 ',
            attachments: [
                { type: 'unknown', url: ' https://example.test/photo.jpg ', mimeType: ' image/jpeg ', size: '42' },
                { type: 'image', url: '', mimeType: 'video/mp4', path: ' videos/clip.mp4 ' },
                null
            ],
            reactions: {
                thumbs_up: [' parent-1 ', 'parent-1', '', 'coach-1'],
                empty: []
            },
            mentionedUids: [' player-1 ', 'player-1', null],
            recipientIds: [' parent-1 ', 'parent-2', 'parent-1'],
            targetType: 'staff',
            createdAt,
            editedAt
        }, 'message-1')).toMatchObject({
            id: 'message-1',
            clientMessageId: 'client-1',
            text: 'Team update',
            senderId: 'coach-1',
            targetType: 'staff',
            recipientIds: ['parent-1', 'parent-2'],
            mentionedUids: ['player-1'],
            reactions: {
                thumbs_up: ['parent-1', 'coach-1']
            },
            createdAt: new Date('2025-10-20T13:10:00.250Z'),
            editedAt: new Date(1760966100123),
            attachments: [
                expect.objectContaining({
                    type: 'image',
                    url: 'https://example.test/photo.jpg',
                    mimeType: 'image/jpeg',
                    size: 42
                }),
                expect.objectContaining({
                    type: 'image',
                    url: null,
                    path: 'videos/clip.mp4',
                    mimeType: 'video/mp4'
                })
            ]
        });
    });

    it('maps schedule game and practice documents through typed event records', () => {
        const gameDocument: FirestoreDocument = {
            name: 'projects/allplays/databases/(default)/documents/teams/team-1/games/game-1',
            fields: {
                type: { stringValue: 'game' },
                date: { timestampValue: '2026-06-20T18:00:00.000Z' },
                opponent: { stringValue: ' Tigers ' },
                location: { stringValue: ' Main Gym ' },
                liveClockMs: { integerValue: '120000' },
                liveClockRunning: { booleanValue: true },
                assignments: {
                    arrayValue: {
                        values: [
                            {
                                mapValue: {
                                    fields: {
                                        role: { stringValue: 'Scoreboard' },
                                        value: { stringValue: 'Open' }
                                    }
                                }
                            }
                        ]
                    }
                },
                sourceMetadata: {
                    mapValue: {
                        fields: {
                            sourceType: { stringValue: 'registration' }
                        }
                    }
                }
            }
        };
        const practiceDocument: FirestoreDocument = {
            name: 'projects/allplays/databases/(default)/documents/teams/team-1/games/practice-1',
            fields: {
                type: { stringValue: 'practice' },
                date: { timestampValue: '2026-06-21T19:00:00.000Z' },
                title: { stringValue: ' Skills Session ' },
                location: { stringValue: ' North Field ' }
            }
        };

        expect(mapScheduleEventDocument(gameDocument)).toMatchObject({
            id: 'game-1',
            type: 'game',
            date: new Date('2026-06-20T18:00:00.000Z'),
            opponent: 'Tigers',
            location: 'Main Gym',
            liveClockMs: 120000,
            liveClockRunning: true,
            assignments: [{ role: 'Scoreboard', value: 'Open' }],
            sourceMetadata: { sourceType: 'registration' }
        });
        expect(mapScheduleEventDocument(practiceDocument)).toMatchObject({
            id: 'practice-1',
            type: 'practice',
            date: new Date('2026-06-21T19:00:00.000Z'),
            title: 'Skills Session',
            location: 'North Field',
            opponent: null,
            assignments: [],
            sourceMetadata: null,
            exDates: []
        });
    });

    it('rejects invalid schedule event documents at the mapper boundary', () => {
        expect(mapScheduleEventRecords([
            { id: 'valid-practice', type: 'practice', date: new Date('2026-06-21T19:00:00.000Z') },
            { id: 'missing-date', type: 'game' },
            { id: 'bad-date', type: 'game', date: 'not a date' },
            { id: 'unsupported-type', type: 'meeting', date: new Date('2026-06-22T19:00:00.000Z') },
            { type: 'game', date: new Date('2026-06-23T19:00:00.000Z') }
        ])).toEqual([
            expect.objectContaining({
                id: 'valid-practice',
                type: 'practice',
                date: new Date('2026-06-21T19:00:00.000Z')
            })
        ]);
        expect(mapScheduleEventDocument({
            name: 'projects/allplays/databases/(default)/documents/teams/team-1/games/bad-game',
            fields: {
                type: { stringValue: 'game' },
                date: { stringValue: 'not-a-date' }
            }
        })).toBeNull();
    });

    it('normalizes partial and malformed game report payloads at the Firestore boundary', () => {
        expect(mapGameReportTeamRecord({
            id: ' ',
            name: '  Hawks  ',
            sport: ' basketball '
        }, 'team-1')).toMatchObject({
            id: 'team-1',
            name: 'Hawks',
            sport: 'basketball'
        });

        expect(mapGameReportPlayerRecords([
            { id: ' p1 ', name: ' Ava ', number: ' 23 ', photoUrl: ' https://example.test/ava.png ' },
            { id: '', name: 'Missing id' },
            null
        ])).toEqual([{
            id: 'p1',
            name: 'Ava',
            number: '23',
            photoUrl: 'https://example.test/ava.png'
        }]);

        expect(mapGameReportGameRecord({
            id: '',
            summary: '  Tight finish  ',
            statSheetPhotoUrl: ' https://example.test/sheet.png ',
            opponentStats: {
                opponent1: {
                    name: '  Riley ',
                    number: ' 4 ',
                    notes: ' linked roster player ',
                    playerId: ' opponent-player-1 ',
                    photoUrl: 8,
                    pts: 12,
                    nested: { value: 1 }
                },
                malformed: null
            }
        }, 'game-1')).toMatchObject({
            id: 'game-1',
            summary: 'Tight finish',
            statSheetPhotoUrl: 'https://example.test/sheet.png',
            opponentStats: {
                opponent1: {
                    name: 'Riley',
                    number: '4',
                    notes: 'linked roster player',
                    playerId: 'opponent-player-1',
                    photoUrl: '8',
                    pts: 12
                },
                malformed: {
                    name: null,
                    number: null,
                    notes: null,
                    playerId: null,
                    photoUrl: null
                }
            }
        });

        expect(mapGameReportOpponentStatsRecord({
            name: { invalid: true },
            number: 0,
            photoUrl: false,
            playerId: ' roster-opponent-1 ',
            notes: ' ',
            pts: 8,
            fouls: '3',
            ignored: Number.NaN,
            nested: { value: 1 }
        })).toEqual({
            name: null,
            number: null,
            notes: null,
            playerId: 'roster-opponent-1',
            photoUrl: null,
            pts: 8,
            fouls: '3'
        });

        expect(mapGameReportAggregatedStatsRecord('p1', {
            stats: {
                pts: 8,
                note: 'starter',
                active: true,
                empty: null,
                nested: { value: 1 },
                invalidNumber: Number.NaN
            },
            timeMs: '1234',
            didNotPlay: true,
            participated: 'yes',
            participationStatus: ' appeared ',
            participationSource: ' standard-tracker '
        })).toEqual({
            id: 'p1',
            stats: {
                pts: 8,
                note: 'starter',
                active: true,
                empty: null
            },
            timeMs: 1234,
            didNotPlay: true,
            participated: false,
            participationStatus: 'appeared',
            participationSource: 'standard-tracker'
        });

        expect(mapGameReportTeamStatsRecord({
            pts: 44,
            rebounds: '31',
            verified: false,
            nested: { value: 1 }
        })).toEqual({
            pts: 44,
            rebounds: '31',
            verified: false
        });

        expect(mapGameReportEventRecords([
            { id: ' e1 ', message: ' Tipoff ', period: '', gameTime: ' 08:00 ', timestamp: 'bad date' },
            { id: 'e2', text: ' Ava scored ', clock: ' 07:31 ', timestamp: { seconds: 1, nanoseconds: 500000000 } },
            {}
        ])).toEqual([
            expect.objectContaining({
                id: 'e1',
                text: 'Tipoff',
                period: 'Q1',
                clock: '08:00',
                timestamp: null
            }),
            expect.objectContaining({
                id: 'e2',
                text: 'Ava scored',
                period: 'Q1',
                clock: '07:31',
                timestamp: new Date(1500)
            })
        ]);
    });
});
