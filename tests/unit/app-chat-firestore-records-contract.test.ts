import { describe, expect, it } from 'vitest';

import {
    mapChatConversationDocument,
    mapChatConversationRecords,
    mapChatMessageDocument,
    mapChatMessageRecords
} from '../../apps/app/src/lib/firestore/mappers.ts';
import type { FirestoreDocument } from '../../apps/app/src/lib/firestore/types.ts';

describe('chat Firestore record boundary', () => {
    it('normalizes native Firestore chat message documents before chat UI consumption', () => {
        const document: FirestoreDocument = {
            name: 'projects/allplays/databases/(default)/documents/teams/team-1/chatMessages/message-1',
            fields: {
                text: { stringValue: '  Practice moved fields  ' },
                senderId: { stringValue: ' coach-1 ' },
                attachments: {
                    arrayValue: {
                        values: [{
                            mapValue: {
                                fields: {
                                    mimeType: { stringValue: 'video/mp4' },
                                    url: { stringValue: ' https://video.example.test/clip.mp4 ' },
                                    size: { integerValue: '512' }
                                }
                            }
                        }]
                    }
                },
                reactions: {
                    mapValue: {
                        fields: {
                            heart: {
                                arrayValue: {
                                    values: [
                                        { stringValue: 'parent-1' },
                                        { stringValue: 'parent-1' },
                                        { stringValue: 'coach-1' }
                                    ]
                                }
                            }
                        }
                    }
                },
                mentionedUids: {
                    arrayValue: {
                        values: [
                            { stringValue: ' parent-2 ' },
                            { stringValue: 'parent-2' }
                        ]
                    }
                },
                createdAt: { timestampValue: '2026-06-20T18:30:00.000Z' }
            }
        };

        expect(mapChatMessageDocument(document)).toMatchObject({
            id: 'message-1',
            text: 'Practice moved fields',
            senderId: 'coach-1',
            attachments: [{
                type: 'video',
                url: 'https://video.example.test/clip.mp4',
                path: null,
                thumbnailUrl: null,
                name: null,
                mimeType: 'video/mp4',
                size: 512,
                uploadedAt: null
            }],
            reactions: {
                heart: ['parent-1', 'coach-1']
            },
            mentionedUids: ['parent-2'],
            createdAt: new Date('2026-06-20T18:30:00.000Z')
        });
    });

    it('drops chat records without ids while preserving typed conversation defaults', () => {
        expect(mapChatMessageRecords([
            { id: ' message-2 ', text: 'Hello' },
            { text: 'missing id' },
            null
        ])).toEqual([
            expect.objectContaining({ id: 'message-2', text: 'Hello' })
        ]);

        expect(mapChatConversationRecords([
            { id: ' thread-1 ', type: 'direct', participantIds: ['parent-1', 'parent-1', 'coach-1'] },
            { name: 'missing id' }
        ])).toEqual([
            expect.objectContaining({
                id: 'thread-1',
                type: 'direct',
                participantIds: ['parent-1', 'coach-1']
            })
        ]);
    });

    it('returns null for missing native chat documents', () => {
        expect(mapChatMessageDocument(null)).toBeNull();
        expect(mapChatConversationDocument({ fields: {} })).toBeNull();
    });
});
