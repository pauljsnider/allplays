import { describe, expect, it } from 'vitest';

import { mapChatConversationRecord, mapFirestoreDocument } from '../../apps/app/src/lib/firestore/mappers.ts';
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
            mutedBy: [' parent-1 ', 'parent-1', null],
            isDefault: true
        }, 'conversation-1')).toEqual({
            id: 'conversation-1',
            type: 'group',
            name: null,
            participantIds: ['parent-1', 'coach-1'],
            participantRoles: ['parent', 'coach'],
            mutedBy: ['parent-1'],
            isDefault: true,
            isLegacy: false,
            updatedAt: null,
            lastMessageAt: null
        });
    });
});
