import { describe, expect, it } from 'vitest';

import { mapChatConversationDocument, mapChatMessageDocument, mapChatMessageRecord, mapChatMessageRecords } from './firestore/mappers';
import type { FirestoreDocument } from './firestore/types';

describe('chat Firestore mappers', () => {
  it('maps a valid Firestore chat message document into a typed message model', () => {
    const document: FirestoreDocument = {
      name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/chatMessages/message-1',
      fields: {
        text: { stringValue: '  Great pass  ' },
        senderId: { stringValue: 'user-1' },
        senderName: { stringValue: 'Coach Kim' },
        senderEmail: { stringValue: 'coach@example.com' },
        attachments: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    type: { stringValue: 'image' },
                    url: { stringValue: 'https://example.com/photo.jpg' },
                    mimeType: { stringValue: 'image/jpeg' },
                    size: { integerValue: '2048' },
                    uploadedAt: { timestampValue: '2026-06-19T19:00:00.000Z' }
                  }
                }
              }
            ]
          }
        },
        createdAt: { timestampValue: '2026-06-19T19:01:00.000Z' },
        reactions: {
          mapValue: {
            fields: {
              heart: {
                arrayValue: {
                  values: [
                    { stringValue: 'user-2' },
                    { stringValue: 'user-3' }
                  ]
                }
              }
            }
          }
        },
        targetType: { stringValue: 'individuals' },
        recipientIds: {
          arrayValue: {
            values: [
              { stringValue: 'user-2' },
              { stringValue: 'user-3' }
            ]
          }
        }
      }
    };

    expect(mapChatMessageDocument(document)).toEqual({
      id: 'message-1',
      clientMessageId: null,
      text: 'Great pass',
      senderId: 'user-1',
      senderName: 'Coach Kim',
      senderEmail: 'coach@example.com',
      senderPhotoUrl: null,
      attachments: [
        {
          type: 'image',
          url: 'https://example.com/photo.jpg',
          path: null,
          thumbnailUrl: null,
          name: null,
          mimeType: 'image/jpeg',
          size: 2048,
          uploadedAt: new Date('2026-06-19T19:00:00.000Z')
        }
      ],
      imageUrl: null,
      imagePath: null,
      imageName: null,
      imageType: null,
      imageSize: null,
      createdAt: new Date('2026-06-19T19:01:00.000Z'),
      editedAt: null,
      deleted: false,
      ai: false,
      aiName: null,
      aiQuestion: null,
      aiMeta: null,
      reactions: {
        heart: ['user-2', 'user-3']
      },
      targetType: 'individuals',
      recipientIds: ['user-2', 'user-3'],
      mentionedUids: [],
      targetRole: null,
      conversationId: null,
      _doc: undefined
    });
  });

  it('normalizes partial Firestore chat message records without breaking preview fields', () => {
    expect(mapChatMessageRecord({
      id: 'message-2',
      text: '   ',
      attachments: [{ mimeType: 'video/mp4', url: ' https://example.com/clip.mp4 ' }],
      reactions: {
        heart: [' user-2 ', '', 'user-2'],
        ignored: 'not-an-array'
      },
      targetType: 'unsupported',
      recipientIds: [' user-4 ', '', 'user-4']
    })).toEqual({
      id: 'message-2',
      clientMessageId: null,
      text: null,
      senderId: null,
      senderName: null,
      senderEmail: null,
      senderPhotoUrl: null,
      attachments: [
        {
          type: 'video',
          url: 'https://example.com/clip.mp4',
          path: null,
          thumbnailUrl: null,
          name: null,
          mimeType: 'video/mp4',
          size: null,
          uploadedAt: null
        }
      ],
      imageUrl: null,
      imagePath: null,
      imageName: null,
      imageType: null,
      imageSize: null,
      createdAt: null,
      editedAt: null,
      deleted: false,
      ai: false,
      aiName: null,
      aiQuestion: null,
      aiMeta: null,
      reactions: {
        heart: ['user-2']
      },
      targetType: 'full_team',
      recipientIds: ['user-4'],
      mentionedUids: [],
      targetRole: null,
      conversationId: null,
      _doc: undefined
    });
  });

  it('maps chat message record lists and drops malformed entries at the boundary', () => {
    expect(mapChatMessageRecords([
      {
        text: 'missing id',
        createdAt: { seconds: Date.parse('2026-06-19T19:02:00.000Z') / 1000 }
      },
      {
        id: 'message-3',
        text: '  Tagged update ',
        attachments: [
          {
            url: 'https://example.com/photo.jpg',
            mimeType: 'image/jpeg',
            uploadedAt: { toMillis: () => Date.parse('2026-06-19T19:01:30.000Z') }
          }
        ],
        reactions: {
          heart: ['user-2', 'user-2', ''],
          clap: [' user-3 ']
        },
        mentionedUids: [' user-4 ', 'user-4', 'user-5'],
        createdAt: { toDate: () => new Date('2026-06-19T19:02:00.000Z') },
        editedAt: { seconds: Date.parse('2026-06-19T19:03:00.000Z') / 1000, nanoseconds: 123000000 }
      }
    ])).toEqual([
      expect.objectContaining({
        id: 'message-3',
        text: 'Tagged update',
        attachments: [
          expect.objectContaining({
            url: 'https://example.com/photo.jpg',
            uploadedAt: new Date('2026-06-19T19:01:30.000Z')
          })
        ],
        reactions: {
          heart: ['user-2'],
          clap: ['user-3']
        },
        mentionedUids: ['user-4', 'user-5'],
        createdAt: new Date('2026-06-19T19:02:00.000Z'),
        editedAt: new Date('2026-06-19T19:03:00.123Z')
      })
    ]);
  });

  it('maps conversation preview metadata from partial Firestore documents', () => {
    const document: FirestoreDocument = {
      name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/chatConversations/conversation-1',
      fields: {
        type: { stringValue: 'direct' },
        participantIds: {
          arrayValue: {
            values: [
              { stringValue: 'user-1' },
              { stringValue: ' user-2 ' },
              { stringValue: 'user-2' }
            ]
          }
        },
        updatedAt: { timestampValue: '2026-06-19T18:30:00.000Z' }
      }
    };

    expect(mapChatConversationDocument(document)).toEqual({
      id: 'conversation-1',
      type: 'direct',
      name: null,
      participantIds: ['user-1', 'user-2'],
      participantRoles: [],
      mutedBy: [],
      isDefault: false,
      isLegacy: false,
      updatedAt: new Date('2026-06-19T18:30:00.000Z'),
      lastMessageAt: null
    });
  });
});
