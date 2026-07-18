// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mapChatConversationDocument, mapChatMessageDocument, mapChatMessageRecord, mapChatMessageRecords } from './firestore/mappers';
import type { FirestoreDocument } from './firestore/types';

const legacyChatServiceMocks = vi.hoisted(() => ({
  GoogleAIBackend: class GoogleAIBackend {},
  canAccessTeamChat: vi.fn(),
  canModerateChat: vi.fn(),
  clearChatMuted: vi.fn(),
  deleteChatMessage: vi.fn(),
  deleteUploadedChatAttachments: vi.fn(),
  editChatMessage: vi.fn(),
  getAI: vi.fn(),
  getAggregatedStatsForGames: vi.fn(),
  getApp: vi.fn(() => ({})),
  getChatConversations: vi.fn(),
  getChatMessages: vi.fn(),
  getGameEvents: vi.fn(),
  getGames: vi.fn(),
  getGenerativeModel: vi.fn(),
  getParentTeams: vi.fn(),
  getPlayers: vi.fn(),
  getSentTeamEmails: vi.fn(),
  getStoredTeamEmailDrafts: vi.fn(),
  getStoredTeamEmailTemplates: vi.fn(),
  getTeam: vi.fn(),
  getUnreadChatCounts: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserProfile: vi.fn(),
  getUserTeamsWithAccess: vi.fn(),
  isTeamActive: vi.fn(() => true),
  postChatMessage: vi.fn(),
  resolveImageFirebaseConfig: vi.fn(() => ({ apiKey: 'test-api-key', storageBucket: 'test-bucket' })),
  saveStoredTeamEmailDraft: vi.fn(),
  saveStoredTeamEmailTemplate: vi.fn(),
  sendTeamEmail: vi.fn(),
  subscribeToChatMessages: vi.fn(),
  toggleChatReaction: vi.fn(),
  updateChatLastRead: vi.fn(),
  updateChatMuted: vi.fn(),
  uploadChatImage: vi.fn(),
  upsertChatConversation: vi.fn()
}));

const nativeRuntime = vi.hoisted(() => ({
  isNativePlatform: false
}));

const authServiceMocks = vi.hoisted(() => ({
  getNativeAuthIdToken: vi.fn()
}));

const uxTimingMocks = vi.hoisted(() => ({
  endInteraction: vi.fn(),
  startInteractionTimer: vi.fn(() => ({
    end: uxTimingMocks.endInteraction
  }))
}));

const friendMessageMocks = vi.hoisted(() => ({
  canMessageAcceptedFriend: vi.fn(),
  sendAuthorizedDirectMessage: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativeRuntime.isNativePlatform
  }
}));

vi.mock('./adapters/legacyChatService', () => legacyChatServiceMocks);

vi.mock('./authService', () => ({
  firebaseAuth: {
    app: {
      options: {
        projectId: 'demo-allplays',
        storageBucket: 'primary-allplays-bucket'
      }
    },
    currentUser: { uid: 'user-1' }
  },
  getNativeAuthIdToken: authServiceMocks.getNativeAuthIdToken
}));

vi.mock('./uxTiming', () => ({
  UX_TIMING: {
    chatSend: 'chat-send'
  },
  startInteractionTimer: uxTimingMocks.startInteractionTimer
}));

vi.mock('./friendMessageService', () => friendMessageMocks);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createUploadedAttachment(file: File, urlName = file.name) {
  return {
    type: file.type.startsWith('video/') ? 'video' : 'image',
    url: `https://firebasestorage.googleapis.com/v0/b/allplays-images/o/${encodeURIComponent(urlName)}?alt=media`,
    path: `team-photos/1700000000000_chat_team-1_team_user-1_${urlName}`,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    thumbnailUrl: null
  };
}

function buildSendInput(files: File[]) {
  return {
    teamId: 'team-1',
    user: {
      uid: 'user-1',
      email: 'coach@example.test',
      displayName: 'Coach Taylor',
      roles: ['coach' as const]
    },
    profile: {
      fullName: 'Coach T',
      photoUrl: 'https://cdn.example.test/coach.jpg'
    },
    text: 'Practice photos',
    files,
    selectedConversation: null,
    selectedConversationId: 'team',
    selectedRecipientTarget: 'full_team' as const,
    selectedRecipientIds: []
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  nativeRuntime.isNativePlatform = false;
  authServiceMocks.getNativeAuthIdToken.mockResolvedValue('main-user-id-token');
  uxTimingMocks.startInteractionTimer.mockReturnValue({
    end: uxTimingMocks.endInteraction
  });
  legacyChatServiceMocks.resolveImageFirebaseConfig.mockReturnValue({ apiKey: 'test-api-key', storageBucket: 'test-bucket' });
  legacyChatServiceMocks.postChatMessage.mockResolvedValue({ id: 'message-1' });
  friendMessageMocks.canMessageAcceptedFriend.mockResolvedValue(true);
  friendMessageMocks.sendAuthorizedDirectMessage.mockResolvedValue({ id: 'direct-message-1' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
      directAccess: null,
      directUserIds: [],
      friendshipId: null,
      initiatedBy: null,
      mutedBy: [],
      isDefault: false,
      isLegacy: false,
      updatedAt: new Date('2026-06-19T18:30:00.000Z'),
      lastMessageAt: null
    });
  });
});

describe('sendTeamChatMessage attachment uploads', () => {
  it('rechecks friend access at send time and stores server-verifiable direct metadata', async () => {
    legacyChatServiceMocks.upsertChatConversation.mockImplementation(async (_teamId, conversation) => ({
      id: 'direct_user-1__user%3Afriend-1',
      ...conversation
    }));
    const { sendTeamChatMessage } = await import('./chatService');

    await sendTeamChatMessage({
      ...buildSendInput([]),
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['user:friend-1']
    });

    expect(friendMessageMocks.canMessageAcceptedFriend).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      'friend-1',
      'team-1'
    );
    expect(legacyChatServiceMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
      type: 'direct',
      directAccess: 'accepted_friend',
      directUserIds: ['friend-1', 'user-1'],
      friendshipId: 'friend-1__user-1',
      initiatedBy: null
    }));
    expect(friendMessageMocks.sendAuthorizedDirectMessage).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      conversationId: 'direct_user-1__user%3Afriend-1',
      text: 'Practice photos'
    }));
    expect(legacyChatServiceMocks.postChatMessage).not.toHaveBeenCalled();
  });

  it('fails a revoked friend send before creating a conversation or uploading attachments', async () => {
    friendMessageMocks.canMessageAcceptedFriend.mockResolvedValue(false);
    const { sendTeamChatMessage } = await import('./chatService');

    await expect(sendTeamChatMessage({
      ...buildSendInput([]),
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['user:friend-1']
    })).rejects.toThrow(/accepted friend/i);

    expect(legacyChatServiceMocks.upsertChatConversation).not.toHaveBeenCalled();
    expect(legacyChatServiceMocks.postChatMessage).not.toHaveBeenCalled();
    expect(legacyChatServiceMocks.uploadChatImage).not.toHaveBeenCalled();
  });

  it('uses the primary bucket and main user token for native chat uploads', async () => {
    nativeRuntime.isNativePlatform = true;
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        name: 'stat-sheets/team-chat/team-1/group_user%3Acoach-1/user-1/1700000000000_arrival_photo.jpg',
        downloadTokens: 'download-token'
      })
    });
    vi.stubGlobal('fetch', fetchMock);
    const photo = new File(['photo'], 'arrival photo.jpg', { type: 'image/jpeg' });

    const { uploadTeamChatAttachment } = await import('./chatService');
    const attachment = await uploadTeamChatAttachment('team-1', photo, 'group_user%3Acoach-1');

    expect(authServiceMocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain('/v0/b/primary-allplays-bucket/o?uploadType=media');
    expect(decodeURIComponent(url)).toContain('name=stat-sheets/team-chat/team-1/group_user%3Acoach-1/user-1/1700000000000_arrival_photo.jpg');
    expect(request).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer main-user-id-token' }),
      body: photo
    }));
    expect(attachment.path).toBe('stat-sheets/team-chat/team-1/group_user%3Acoach-1/user-1/1700000000000_arrival_photo.jpg');
    expect(fetchMock.mock.calls.flatMap((call) => call.map(String)).join(' ')).not.toContain('identitytoolkit.googleapis.com');
  });

  it('starts multiple uploads before the first resolves and posts attachments in the original order', async () => {
    const first = new File(['first'], 'first.jpg', { type: 'image/jpeg' });
    const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' });
    const third = new File(['third'], 'third.jpg', { type: 'image/jpeg' });
    const uploadedFirst = createUploadedAttachment(first);
    const uploadedSecond = createUploadedAttachment(second);
    const uploadedThird = createUploadedAttachment(third);
    const uploadStarts: string[] = [];
    const uploadDeferreds = new Map<string, Deferred<ReturnType<typeof createUploadedAttachment>>>();

    legacyChatServiceMocks.uploadChatImage.mockImplementation((_teamId: string, file: File) => {
      uploadStarts.push(file.name);
      const deferred = createDeferred<ReturnType<typeof createUploadedAttachment>>();
      uploadDeferreds.set(file.name, deferred);
      return deferred.promise;
    });

    const { sendTeamChatMessage } = await import('./chatService');
    const sendPromise = sendTeamChatMessage(buildSendInput([first, second, third]));

    expect(uploadStarts.slice(0, 2)).toEqual(['first.jpg', 'second.jpg']);
    expect(legacyChatServiceMocks.postChatMessage).not.toHaveBeenCalled();

    uploadDeferreds.get('second.jpg')?.resolve(uploadedSecond);
    uploadDeferreds.get('third.jpg')?.resolve(uploadedThird);
    await Promise.resolve();
    expect(legacyChatServiceMocks.postChatMessage).not.toHaveBeenCalled();

    uploadDeferreds.get('first.jpg')?.resolve(uploadedFirst);
    await sendPromise;

    expect(legacyChatServiceMocks.uploadChatImage).toHaveBeenCalledTimes(3);
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalledTimes(1);
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
      attachments: [uploadedFirst, uploadedSecond, uploadedThird]
    }));
  });

  it('finishes an equal-delay 3-file send in one parallel batch and posts once after uploads finish', async () => {
    vi.useFakeTimers();
    const files = [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.jpg', { type: 'image/jpeg' }),
      new File(['three'], 'three.jpg', { type: 'image/jpeg' })
    ];
    const fileNames = files.map((file) => file.name);
    const uploadStarts: string[] = [];
    const uploadFinishes: string[] = [];
    const uploadDelayMs = 100;

    legacyChatServiceMocks.uploadChatImage.mockImplementation((_teamId: string, file: File) => new Promise((resolve) => {
      uploadStarts.push(file.name);
      window.setTimeout(() => {
        uploadFinishes.push(file.name);
        resolve(createUploadedAttachment(file));
      }, uploadDelayMs);
    }));
    legacyChatServiceMocks.postChatMessage.mockImplementation(async () => {
      expect(uploadFinishes).toEqual(fileNames);
      return { id: 'message-1' };
    });

    const { sendTeamChatMessage } = await import('./chatService');
    const sendPromise = sendTeamChatMessage(buildSendInput(files));

    expect(uploadStarts).toEqual(fileNames);
    await vi.advanceTimersByTimeAsync(uploadDelayMs - 1);
    expect(legacyChatServiceMocks.postChatMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalledTimes(1);

    await sendPromise;
    expect(legacyChatServiceMocks.uploadChatImage).toHaveBeenCalledTimes(3);
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalledTimes(1);
  });

  it('skips interaction timing when requested without changing chat delivery', async () => {
    const { sendTeamChatMessage } = await import('./chatService');

    const result = await sendTeamChatMessage({
      ...buildSendInput([]),
      skipInteractionTiming: true
    });

    expect(uxTimingMocks.startInteractionTimer).not.toHaveBeenCalled();
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
      text: 'Practice photos'
    }));
    expect(result).toEqual(expect.objectContaining({
      conversationId: 'team',
      createdConversation: null,
      wantsAi: false
    }));
  });
});

describe('subscribeToTeamChatMessages', () => {
  it('forwards async Firestore listener errors to the caller', async () => {
    const unsubscribe = vi.fn();
    const onMessages = vi.fn();
    const onError = vi.fn();
    legacyChatServiceMocks.subscribeToChatMessages.mockReturnValue(unsubscribe);

    const { subscribeToTeamChatMessages } = await import('./chatService');
    const subscription = subscribeToTeamChatMessages('team-1', 'team', onMessages, onError);

    expect(legacyChatServiceMocks.subscribeToChatMessages).toHaveBeenCalledWith(
      'team-1',
      { limit: 50, conversationId: 'team' },
      expect.any(Function),
      onError
    );

    const forwardedOnError = legacyChatServiceMocks.subscribeToChatMessages.mock.calls[0][3];
    const listenerError = new Error('Firestore listener failed');
    forwardedOnError(listenerError);

    expect(onError).toHaveBeenCalledWith(listenerError);
    subscription.unsubscribe();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
