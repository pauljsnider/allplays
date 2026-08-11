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
  repairLegacyDirectConversation: vi.fn(),
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
  getNativeAuthIdToken: vi.fn(),
  getNativeAuthUserId: vi.fn()
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
const nativeStorageMocks = vi.hoisted(() => ({
  deleteNativePrimaryStorageFile: vi.fn()
}));
const profileServiceMocks = vi.hoisted(() => ({
  loadManagedTeamsFromNativeCallable: vi.fn()
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
  getNativeAuthIdToken: authServiceMocks.getNativeAuthIdToken,
  getNativeAuthUserId: authServiceMocks.getNativeAuthUserId
}));

vi.mock('./uxTiming', () => ({
  UX_TIMING: {
    chatSend: 'chat-send'
  },
  startInteractionTimer: uxTimingMocks.startInteractionTimer
}));

vi.mock('./friendMessageService', () => friendMessageMocks);
vi.mock('./nativeStorageUpload', () => nativeStorageMocks);
vi.mock('./profileService', () => profileServiceMocks);

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
  nativeStorageMocks.deleteNativePrimaryStorageFile.mockResolvedValue(undefined);
  authServiceMocks.getNativeAuthIdToken.mockResolvedValue('main-user-id-token');
  authServiceMocks.getNativeAuthUserId.mockReturnValue('user-1');
  uxTimingMocks.startInteractionTimer.mockReturnValue({
    end: uxTimingMocks.endInteraction
  });
  legacyChatServiceMocks.resolveImageFirebaseConfig.mockReturnValue({ apiKey: 'test-api-key', storageBucket: 'test-bucket' });
  legacyChatServiceMocks.postChatMessage.mockResolvedValue({ id: 'message-1' });
  legacyChatServiceMocks.repairLegacyDirectConversation.mockImplementation(async (_teamId, conversationId) => ({
    id: conversationId,
    type: 'group',
    participantIds: ['user-1', 'email:guardian@example.test'],
    participantRoles: []
  }));
  friendMessageMocks.canMessageAcceptedFriend.mockResolvedValue(true);
  friendMessageMocks.sendAuthorizedDirectMessage.mockResolvedValue({ id: 'direct-message-1' });
  profileServiceMocks.loadManagedTeamsFromNativeCallable.mockRejectedValue(new Error('Managed team callable is unavailable.'));
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-1111-1111-111111111111' });
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

describe('native chat team discovery fallback', () => {
  function jsonResponse(payload: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: vi.fn().mockResolvedValue(payload)
    };
  }

  function firestoreDocument(path: string, fields: Record<string, unknown>) {
    return {
      name: `projects/demo-allplays/databases/(default)/documents/${path}`,
      fields
    };
  }

  function installNativeTeamFetch({ includeTeams }: { includeTeams: boolean }) {
    const fetchMock = vi.fn(async (url: string, request: RequestInit = {}) => {
      if (String(url).includes('/documents/users/user-1')) {
        return jsonResponse(firestoreDocument('users/user-1', {
          parentOf: {
            arrayValue: {
              values: includeTeams ? [{
                mapValue: {
                  fields: { teamId: { stringValue: 'team-parent' } }
                }
              }] : []
            }
          }
        }));
      }
      if (String(url).endsWith('/documents:runQuery')) {
        const body = JSON.parse(String(request.body || '{}'));
        const fieldPath = body?.structuredQuery?.where?.fieldFilter?.field?.fieldPath;
        if (fieldPath === 'adminEmails') {
          return jsonResponse({ error: { message: 'Missing or insufficient permissions.' } }, 403);
        }
        return jsonResponse(includeTeams ? [{
          document: firestoreDocument('teams/team-owned', {
            name: { stringValue: 'Vipers' },
            ownerId: { stringValue: 'user-1' },
            active: { booleanValue: true }
          })
        }] : []);
      }
      if (String(url).includes(':runAggregationQuery')) {
        return jsonResponse([{
          result: {
            aggregateFields: {
              messageCount: { integerValue: '0' }
            }
          }
        }]);
      }
      if (String(url).includes('/documents/teams/team-parent')) {
        return jsonResponse(firestoreDocument('teams/team-parent', {
          name: { stringValue: 'Jr KC Current' },
          active: { booleanValue: true }
        }));
      }
      throw new Error(`Unexpected native request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    nativeRuntime.isNativePlatform = true;
    legacyChatServiceMocks.getUserProfile.mockRejectedValue(new Error('Web Firestore is not authenticated.'));
    legacyChatServiceMocks.getUserTeamsWithAccess.mockRejectedValue(new Error('Managed team callable is unavailable.'));
    legacyChatServiceMocks.getParentTeams.mockRejectedValue(new Error('Web Firestore is not authenticated.'));
    legacyChatServiceMocks.canAccessTeamChat.mockReturnValue(true);
    legacyChatServiceMocks.canModerateChat.mockReturnValue(false);
    legacyChatServiceMocks.isTeamActive.mockReturnValue(true);
    legacyChatServiceMocks.getUnreadChatCounts.mockResolvedValue({});
    profileServiceMocks.loadManagedTeamsFromNativeCallable.mockRejectedValue(new Error('Managed team callable is unavailable.'));
  });

  it('uses complete server-authoritative discovery for an admin-email-only native coach', async () => {
    installNativeTeamFetch({ includeTeams: false });
    profileServiceMocks.loadManagedTeamsFromNativeCallable.mockResolvedValue({
      teams: [{ id: 'team-admin', name: 'Admin Bears', active: true }],
      isPartial: false
    });
    legacyChatServiceMocks.canAccessTeamChat.mockReturnValue(false);
    const { loadChatInbox } = await import('./chatService');

    const result = await loadChatInbox({
      uid: 'user-1',
      email: 'coach@example.test',
      displayName: 'Coach Taylor',
      roles: []
    }, { includeLastMessages: false });

    expect(result.teams).toEqual([
      expect.objectContaining({ id: 'team-admin', name: 'Admin Bears' })
    ]);
    expect(result.isPartial).toBe(false);
    expect(profileServiceMocks.loadManagedTeamsFromNativeCallable).toHaveBeenCalledTimes(1);
  });

  it('returns nonempty proven owner and parent teams when the legacy admin-email query is denied', async () => {
    const fetchMock = installNativeTeamFetch({ includeTeams: true });
    const { loadChatInbox } = await import('./chatService');

    const result = await loadChatInbox({
      uid: 'user-1',
      email: 'coach@example.test',
      displayName: 'Coach Taylor',
      roles: []
    }, { includeLastMessages: false });

    expect(result.teams).toEqual([
      expect.objectContaining({ id: 'team-parent', name: 'Jr KC Current' }),
      expect.objectContaining({ id: 'team-owned', name: 'Vipers' })
    ]);
    expect(result.isPartial).toBe(true);
    expect(legacyChatServiceMocks.getUserProfile).not.toHaveBeenCalled();
    expect(legacyChatServiceMocks.getUserTeamsWithAccess).not.toHaveBeenCalled();
    expect(legacyChatServiceMocks.getParentTeams).not.toHaveBeenCalled();
    expect(legacyChatServiceMocks.getUnreadChatCounts).not.toHaveBeenCalled();
    const requestedFields = fetchMock.mock.calls
      .map(([, request]) => JSON.parse(String((request as RequestInit | undefined)?.body || '{}')))
      .map((body) => body?.structuredQuery?.where?.fieldFilter?.field?.fieldPath)
      .filter(Boolean);
    expect(requestedFields).toEqual(['ownerId']);
  });

  it('uses complete native callable team discovery before the partial direct-read fallback', async () => {
    profileServiceMocks.loadManagedTeamsFromNativeCallable.mockResolvedValue({
      teams: [{
        id: 'team-admin',
        name: 'Admin Email Team',
        adminEmails: ['coach@example.test'],
        active: true
      }],
      isPartial: false
    });
    const fetchMock = installNativeTeamFetch({ includeTeams: false });
    const { loadChatInbox } = await import('./chatService');

    const result = await loadChatInbox({
      uid: 'user-1',
      email: 'coach@example.test',
      displayName: 'Coach Taylor',
      roles: []
    }, { includeLastMessages: false });

    expect(result.teams).toEqual([
      expect.objectContaining({ id: 'team-admin', name: 'Admin Email Team' })
    ]);
    expect(result.isPartial).toBe(false);
    expect(profileServiceMocks.loadManagedTeamsFromNativeCallable).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/documents:runQuery'))).toBe(false);
  });

  it('merges verified parent-linked teams when managed callable discovery succeeds empty', async () => {
    profileServiceMocks.loadManagedTeamsFromNativeCallable.mockResolvedValue({
      teams: [],
      isPartial: false
    });
    const fetchMock = installNativeTeamFetch({ includeTeams: true });
    const { loadChatInbox } = await import('./chatService');

    const result = await loadChatInbox({
      uid: 'user-1',
      email: 'parent@example.test',
      displayName: 'Pat Parent',
      roles: []
    }, { includeLastMessages: false });

    expect(result.teams).toEqual([
      expect.objectContaining({ id: 'team-parent', name: 'Jr KC Current', role: 'Parent' })
    ]);
    expect(profileServiceMocks.loadManagedTeamsFromNativeCallable).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/documents/teams/team-parent'))).toBe(true);
  });

  it('loads native unread counts through authenticated aggregation queries', async () => {
    profileServiceMocks.loadManagedTeamsFromNativeCallable.mockResolvedValue({
      teams: [{
        id: 'team-admin',
        name: 'Admin Email Team',
        adminEmails: ['coach@example.test'],
        active: true,
        lastMessageAt: new Date('2026-08-11T12:00:00.000Z')
      }],
      isPartial: false
    });
    const fetchMock = vi.fn(async (url: string, request?: RequestInit) => {
      if (String(url).includes('/documents/users/user-1')) {
        return jsonResponse(firestoreDocument('users/user-1', {
          teamChatState: {
            mapValue: {
              fields: {
                'team-admin': {
                  mapValue: {
                    fields: {
                      lastReadAt: { timestampValue: '2026-08-11T11:00:00.000Z' }
                    }
                  }
                }
              }
            }
          }
        }));
      }
      if (String(url).includes(':runAggregationQuery')) {
        const body = JSON.parse(String(request?.body || '{}'));
        const isOwnCount = JSON.stringify(body).includes('senderId');
        return jsonResponse([{
          result: {
            aggregateFields: {
              messageCount: { integerValue: isOwnCount ? '2' : '3' }
            }
          }
        }]);
      }
      throw new Error(`Unexpected native request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadChatInbox } = await import('./chatService');

    const result = await loadChatInbox({
      uid: 'user-1',
      email: 'coach@example.test',
      displayName: 'Coach Taylor',
      roles: []
    }, { includeLastMessages: false });

    expect(result.teams).toEqual([
      expect.objectContaining({ id: 'team-admin', unreadCount: 1 })
    ]);
    expect(result.isPartial).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(':runAggregationQuery'))).toHaveLength(2);
    expect(legacyChatServiceMocks.getUnreadChatCounts).not.toHaveBeenCalled();
  });

  it('marks native unread counts partial when an authenticated aggregation fails', async () => {
    profileServiceMocks.loadManagedTeamsFromNativeCallable.mockResolvedValue({
      teams: [{
        id: 'team-admin',
        name: 'Admin Email Team',
        active: true,
        lastMessageAt: new Date('2026-08-11T12:00:00.000Z')
      }],
      isPartial: false
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/documents/users/user-1')) {
        return jsonResponse(firestoreDocument('users/user-1', {}));
      }
      if (String(url).includes(':runAggregationQuery')) {
        return jsonResponse({ error: { message: 'Unread count unavailable.' } }, 503);
      }
      throw new Error(`Unexpected native request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadChatInbox } = await import('./chatService');

    const result = await loadChatInbox({
      uid: 'user-1',
      email: 'coach@example.test',
      displayName: 'Coach Taylor',
      roles: []
    }, { includeLastMessages: false });

    expect(result.teams).toEqual([
      expect.objectContaining({ id: 'team-admin', unreadCount: 0 })
    ]);
    expect(result.isPartial).toBe(true);
  });

  it('does not turn a partial-empty native fallback into an authoritative empty inbox', async () => {
    installNativeTeamFetch({ includeTeams: false });
    const { loadChatInbox } = await import('./chatService');

    await expect(loadChatInbox({
      uid: 'user-1',
      email: 'coach@example.test',
      displayName: 'Coach Taylor',
      roles: []
    }, { includeLastMessages: false })).rejects.toThrow(/could not be completely verified/i);
  });
});

describe('sendTeamChatMessage attachment uploads', () => {
  it('uses authenticated native Storage cleanup instead of the signed-out web SDK', async () => {
    nativeRuntime.isNativePlatform = true;
    const { deleteTeamChatAttachments } = await import('./chatService');

    await deleteTeamChatAttachments([{
      ...createUploadedAttachment(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })),
      type: 'image' as const,
      path: 'stat-sheets/team-chat/team-1/team/user-1/photo.jpg'
    }]);

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).toHaveBeenCalledWith(
      'stat-sheets/team-chat/team-1/team/user-1/photo.jpg'
    );
    expect(legacyChatServiceMocks.deleteUploadedChatAttachments).not.toHaveBeenCalled();
  });

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
      createOnly: true,
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

  it('keeps a selected email-only guardian on an authorized group thread', async () => {
    legacyChatServiceMocks.upsertChatConversation.mockImplementation(async (_teamId, conversation) => ({
      id: 'group_user-1__email%3Aguardian%40example.test',
      ...conversation
    }));
    const { sendTeamChatMessage } = await import('./chatService');

    const result = await sendTeamChatMessage({
      ...buildSendInput([]),
      text: '@ALL PLAYS summarize the plan',
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['email:guardian@example.test']
    });

    expect(legacyChatServiceMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
      type: 'group',
      participantIds: ['user-1', 'email:guardian@example.test']
    }));
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
      conversationId: 'group_user-1__email%3Aguardian%40example.test',
      targetType: 'individuals'
    }));
    expect(friendMessageMocks.canMessageAcceptedFriend).not.toHaveBeenCalled();
    expect(friendMessageMocks.sendAuthorizedDirectMessage).not.toHaveBeenCalled();
    expect(result.wantsAi).toBe(true);
  });

  it('repairs an existing email-based legacy direct thread in place before sending', async () => {
    const { sendTeamChatMessage } = await import('./chatService');
    const conversationId = 'direct_user-1__email%3Aguardian%40example.test';

    const result = await sendTeamChatMessage({
      ...buildSendInput([]),
      selectedConversation: {
        id: conversationId,
        type: 'direct',
        participantIds: ['user-1', 'email:guardian@example.test'],
        participantRoles: [],
        directAccess: null
      } as any,
      selectedConversationId: conversationId,
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['email:guardian@example.test']
    });

    expect(legacyChatServiceMocks.repairLegacyDirectConversation).toHaveBeenCalledWith('team-1', conversationId);
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
      conversationId,
      recipientIds: ['user-1', 'email:guardian@example.test']
    }));
    expect(friendMessageMocks.sendAuthorizedDirectMessage).not.toHaveBeenCalled();
    expect(result.createdConversation).toMatchObject({ id: conversationId, type: 'group' });
  });

  it('repairs a metadata-less legacy admin direct thread before a parent replies', async () => {
    legacyChatServiceMocks.repairLegacyDirectConversation.mockImplementation(async (_teamId, conversationId) => ({
      id: conversationId,
      type: 'group',
      participantIds: ['user-1', 'coach-2'],
      participantRoles: []
    }));
    const { sendTeamChatMessage } = await import('./chatService');
    const conversationId = 'direct_user-1__coach-2';

    await sendTeamChatMessage({
      ...buildSendInput([]),
      user: {
        uid: 'user-1',
        email: 'parent@example.test',
        displayName: 'Pat Parent',
        roles: ['parent']
      },
      selectedConversation: {
        id: conversationId,
        type: 'direct',
        participantIds: ['user-1', 'coach-2'],
        participantRoles: [],
        directAccess: null
      } as any,
      selectedConversationId: conversationId,
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['coach-2']
    });

    expect(legacyChatServiceMocks.repairLegacyDirectConversation).toHaveBeenCalledWith('team-1', conversationId);
    expect(friendMessageMocks.canMessageAcceptedFriend).not.toHaveBeenCalled();
    expect(friendMessageMocks.sendAuthorizedDirectMessage).not.toHaveBeenCalled();
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
      conversationId,
      recipientIds: ['user-1', 'coach-2']
    }));
  });

  it('keeps user and email aliases for one guardian on a group thread', async () => {
    legacyChatServiceMocks.upsertChatConversation.mockImplementation(async (_teamId, conversation) => ({
      id: 'group_user-1__guardian-aliases',
      ...conversation
    }));
    const { sendTeamChatMessage } = await import('./chatService');

    await sendTeamChatMessage({
      ...buildSendInput([]),
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['user:guardian-1', 'email:guardian@example.test']
    });

    expect(legacyChatServiceMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
      type: 'group',
      participantIds: expect.arrayContaining(['user-1', 'user:guardian-1', 'email:guardian@example.test'])
    }));
    expect(legacyChatServiceMocks.upsertChatConversation.mock.calls[0][1].participantIds).toHaveLength(3);
    expect(legacyChatServiceMocks.postChatMessage).toHaveBeenCalled();
    expect(friendMessageMocks.sendAuthorizedDirectMessage).not.toHaveBeenCalled();
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
        name: 'stat-sheets/team-chat/team-1/group_user%3Acoach-1/user-1/1700000000000_11111111111111111111111111111111_arrival_photo.jpg',
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
    expect(decodeURIComponent(url)).toContain('name=stat-sheets/team-chat/team-1/group_user%3Acoach-1/user-1/1700000000000_11111111111111111111111111111111_arrival_photo.jpg');
    expect(request).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer main-user-id-token' }),
      body: photo
    }));
    expect(attachment.path).toBe('stat-sheets/team-chat/team-1/group_user%3Acoach-1/user-1/1700000000000_11111111111111111111111111111111_arrival_photo.jpg');
    expect(fetchMock.mock.calls.flatMap((call) => call.map(String)).join(' ')).not.toContain('identitytoolkit.googleapis.com');
  });

  it('uses the persisted native session user when Firebase Auth has no current user', async () => {
    nativeRuntime.isNativePlatform = true;
    authServiceMocks.getNativeAuthUserId.mockReturnValue('rest-session-user');
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        name: 'stat-sheets/team-chat/team-1/team/rest-session-user/1700000000000_11111111111111111111111111111111_photo.jpg',
        downloadTokens: 'download-token'
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const { uploadTeamChatAttachment } = await import('./chatService');
    const attachment = await uploadTeamChatAttachment(
      'team-1',
      new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    );

    expect(attachment.path).toContain('/rest-session-user/');
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain('/rest-session-user/');
  });

  it('aborts a stalled native upload when the composer deadline expires', async () => {
    vi.useFakeTimers();
    nativeRuntime.isNativePlatform = true;
    let uploadSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, request: RequestInit) => {
      uploadSignal = request.signal as AbortSignal;
      return new Promise(() => {});
    }));

    const { uploadTeamChatAttachment } = await import('./chatService');
    const upload = uploadTeamChatAttachment(
      'team-1',
      new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    );
    const rejection = expect(upload).rejects.toThrow('Chat media upload timed out');

    await vi.advanceTimersByTimeAsync(25000);
    await rejection;
    expect(uploadSignal?.aborted).toBe(true);
    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).toHaveBeenCalledWith(
      expect.stringMatching(/^stat-sheets\/team-chat\/team-1\/team\/user-1\/\d+_11111111111111111111111111111111_photo\.jpg$/)
    );
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
  function nativeMessageDocument(id: string, fields: Record<string, unknown> = {}) {
    const encodeValue = (value: unknown): Record<string, unknown> => {
      if (value === null) return { nullValue: 'NULL_VALUE' };
      if (typeof value === 'string') return { stringValue: value };
      if (typeof value === 'boolean') return { booleanValue: value };
      if (typeof value === 'number') return { integerValue: String(value) };
      if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
      return {
        mapValue: {
          fields: Object.entries(value as Record<string, unknown>).reduce<Record<string, Record<string, unknown>>>((encoded, [key, entry]) => {
            encoded[key] = encodeValue(entry);
            return encoded;
          }, {})
        }
      };
    };

    return {
      name: `projects/demo-allplays/databases/(default)/documents/teams/team-1/chatMessages/${id}`,
      fields: Object.entries({
        text: 'Original message',
        createdAt: '2026-08-10T17:00:00.000Z',
        ...fields
      }).reduce<Record<string, Record<string, unknown>>>((encoded, [key, value]) => {
        encoded[key] = key.endsWith('At') && typeof value === 'string'
          ? { timestampValue: value }
          : encodeValue(value);
        return encoded;
      }, {})
    };
  }

  function mockNativePolls(payloads: Array<Array<ReturnType<typeof nativeMessageDocument>>>) {
    const fetchMock = vi.fn().mockImplementation(() => {
      const documents = payloads[Math.min(fetchMock.mock.calls.length - 1, payloads.length - 1)];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ documents })
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('deduplicates equivalent native polls and emits each visible message revision once', async () => {
    vi.useFakeTimers();
    nativeRuntime.isNativePlatform = true;
    legacyChatServiceMocks.subscribeToChatMessages.mockImplementation(() => {
      throw new Error('Firestore listener unavailable');
    });
    const original = nativeMessageDocument('message-1', { _doc: { cursor: 'first-object' } });
    const equivalent = nativeMessageDocument('message-1', { _doc: { cursor: 'regenerated-object' } });
    const added = nativeMessageDocument('message-2', { text: 'Added message' });
    const edited = nativeMessageDocument('message-1', {
      text: 'Edited message',
      editedAt: '2026-08-10T17:05:00.000Z'
    });
    const deleted = nativeMessageDocument('message-1', { deleted: true });
    const reacted = nativeMessageDocument('message-1', { reactions: { heart: ['user-2'] } });
    const attachmentChanged = nativeMessageDocument('message-1', {
      attachments: [{
        type: 'image',
        url: 'https://example.test/photo.jpg',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 2048
      }]
    });
    const fetchMock = mockNativePolls([
      [original],
      [equivalent],
      [equivalent, added],
      [equivalent],
      [edited],
      [deleted],
      [reacted],
      [attachmentChanged]
    ]);
    const onMessages = vi.fn();

    const { subscribeToTeamChatMessages } = await import('./chatService');
    const subscription = subscribeToTeamChatMessages('team-1', 'team', onMessages);
    await vi.advanceTimersByTimeAsync(0);

    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(onMessages.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'message-1', text: 'Original message' })]);

    await vi.advanceTimersByTimeAsync(8000);
    expect(onMessages).toHaveBeenCalledTimes(1);

    for (let expectedEmissions = 2; expectedEmissions <= 7; expectedEmissions += 1) {
      await vi.advanceTimersByTimeAsync(8000);
      expect(onMessages).toHaveBeenCalledTimes(expectedEmissions);
    }

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(onMessages.mock.calls.map(([messages]) => messages)).toEqual([
      [expect.objectContaining({ id: 'message-1', text: 'Original message' })],
      [expect.objectContaining({ id: 'message-1' }), expect.objectContaining({ id: 'message-2' })],
      [expect.objectContaining({ id: 'message-1' })],
      [expect.objectContaining({ text: 'Edited message' })],
      [expect.objectContaining({ deleted: true })],
      [expect.objectContaining({ reactions: { heart: ['user-2'] } })],
      [expect.objectContaining({ attachments: [expect.objectContaining({ url: 'https://example.test/photo.jpg' })] })]
    ]);

    subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(16000);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('does not emit or report errors after an in-flight native poll is unsubscribed', async () => {
    vi.useFakeTimers();
    nativeRuntime.isNativePlatform = true;
    legacyChatServiceMocks.subscribeToChatMessages.mockImplementation(() => {
      throw new Error('Firestore listener unavailable');
    });
    const response = createDeferred<{ ok: boolean; status: number; json: () => Promise<{ documents: ReturnType<typeof nativeMessageDocument>[] }> }>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const onMessages = vi.fn();
    const onError = vi.fn();

    const { subscribeToTeamChatMessages } = await import('./chatService');
    const subscription = subscribeToTeamChatMessages('team-1', 'team', onMessages, onError);
    await vi.advanceTimersByTimeAsync(0);
    subscription.unsubscribe();
    response.resolve({
      ok: true,
      status: 200,
      json: async () => ({ documents: [nativeMessageDocument('message-1')] })
    });
    await vi.advanceTimersByTimeAsync(24000);

    expect(onMessages).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
