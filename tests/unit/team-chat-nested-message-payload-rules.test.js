import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const appChatSource = readFileSync(new URL('../../apps/app/src/lib/chatService.ts', import.meta.url), 'utf8');
const appAiSource = readFileSync(new URL('../../apps/app/src/lib/chatAiService.ts', import.meta.url), 'utf8');
const chatPageSource = readFileSync(new URL('../../team-chat.html', import.meta.url), 'utf8');

describe('nested team chat message payload contracts', () => {
    it('validates the complete create shape, trusted sender fields, server time, targets, and media', () => {
        expect(rules).toContain('function isNestedChatMessageCreateValid(teamId, conversationId, conversationData, data)');
        expect(rules).toContain("data.keys().hasAll([\n               'text', 'senderId', 'attachments', 'createdAt', 'targetType'");
        expect(rules).toContain("data.keys().hasOnly([\n               'clientMessageId', 'text', 'senderId'");
        expect(rules).toContain('data.senderId == request.auth.uid');
        expect(rules).toContain('data.senderEmail.lower() == request.auth.token.email.lower()');
        expect(rules).toContain('data.createdAt == request.time');
        expect(rules).toContain("data.get('editedAt', null) == null");
        expect(rules).toContain("data.get('deleted', false) == false");
        expect(rules).toContain("data.get('ai', false) == false");
        expect(rules).toContain("data.get('aiMeta', null) == null");
        expect(rules).toContain('function hasValidNestedChatAttachments(teamId, conversationId, data)');
        expect(rules).toContain('data.attachments.size() <= 10');
        expect(rules).toContain('attachment.size <= 5 * 1024 * 1024');
        expect(rules).toContain("value.matches('https://firebasestorage[.]googleapis[.]com/.*')");
        expect(rules).toContain('function isNestedChatMessageTargetValid(teamId, conversationId, conversationData, data)');
        expect(rules).toContain("conversationData.get('type', '') in ['direct', 'group']");
        expect(rules).toContain("data.recipientIds == conversationData.get('participantIds', [])");
    });

    it('keeps the legacy full-team message rules independent from the nested validator', () => {
        const legacyStart = rules.indexOf('match /chatMessages/{messageId} {');
        const conversationStart = rules.indexOf('match /chatConversations/{conversationId} {');
        const legacyBlock = rules.slice(legacyStart, conversationStart);

        expect(legacyBlock).toContain('isFullTeamChatMessage(request.resource.data);');
        expect(legacyBlock).not.toContain('isNestedChatMessageCreateValid');
    });

    it('writes server-authored timestamps and canonical conversation participants from every client path', () => {
        expect(dbSource).toContain('const createdAt = serverTimestamp();');
        expect(dbSource).toContain('editedAt: serverTimestamp()');
        expect(dbSource).toContain('const isLegacyTeamConversation = isDefaultTeamConversation(conversationId);');
        expect(dbSource).toContain('imageUrl: isLegacyTeamConversation ?');
        expect(appChatSource).toContain("serverTimestampFields: ['createdAt']");
        expect(appChatSource).toContain("serverTimestampFields: ['editedAt']");
        expect(appChatSource).toContain("setToServerValue: 'REQUEST_TIME'");
        expect(appChatSource).toContain('recipientIds: Array.isArray(createdConversation.participantIds) ? createdConversation.participantIds : participantIds');
        expect(chatPageSource).toContain('recipientIds: Array.isArray(conversation.participantIds) ? conversation.participantIds : participantIds');
    });

    it('does not persist privileged AI identity fields from a targeted client conversation', () => {
        expect(appAiSource).toContain('const isTargetedConversation = !isDefaultTeamConversation(selectedConversationId);');
        expect(appAiSource).toContain('ai: !isTargetedConversation');
        expect(appAiSource).toContain("aiName: isTargetedConversation ? null : 'ALL PLAYS'");
        expect(appAiSource).toContain('aiMeta: isTargetedConversation ? null : {');
        expect(chatPageSource).toContain('ai: !isTargetedConversation');
        expect(chatPageSource).toContain("aiName: isTargetedConversation ? null : 'ALL PLAYS'");
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('nested team chat message rules engine coverage', () => {
    let testEnv;
    const directConversationId = 'direct_parent-1__user-2';
    const staffConversationId = 'group_role%3Astaff';

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-nested-chat-payload-${Date.now()}`,
            firestore: { rules }
        });
    }, 30000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(doc(firestore, 'teams/team-1'), {
                ownerId: 'coach-1',
                adminEmails: ['coach@example.com'],
                chatMemberIds: ['coach-1', 'parent-1', 'user-2']
            });
            await setDoc(doc(firestore, 'users/coach-1'), {
                email: 'coach@example.com',
                isAdmin: false,
                parentTeamIds: []
            });
            await setDoc(doc(firestore, 'users/parent-1'), {
                email: 'parent@example.com',
                isAdmin: false,
                parentTeamIds: ['team-1']
            });
            await setDoc(doc(firestore, `teams/team-1/chatConversations/${directConversationId}`), {
                type: 'direct',
                participantIds: ['parent-1', 'user-2'],
                participantRoles: [],
                mutedBy: []
            });
            await setDoc(doc(firestore, `teams/team-1/chatConversations/${staffConversationId}`), {
                type: 'group',
                participantIds: [],
                participantRoles: ['staff'],
                mutedBy: []
            });
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    function authedFirestore(uid, email) {
        return testEnv.authenticatedContext(uid, { email }).firestore();
    }

    function messageRef(firestore, conversationId, messageId) {
        return doc(firestore, `teams/team-1/chatConversations/${conversationId}/chatMessages/${messageId}`);
    }

    function directPayload(overrides = {}) {
        return {
            clientMessageId: null,
            text: 'Private team update',
            senderId: 'parent-1',
            senderName: 'Pat Parent',
            senderEmail: 'parent@example.com',
            senderPhotoUrl: null,
            attachments: [],
            imageUrl: null,
            imagePath: null,
            imageName: null,
            imageType: null,
            imageSize: null,
            createdAt: serverTimestamp(),
            editedAt: null,
            deleted: false,
            ai: false,
            aiName: null,
            aiQuestion: null,
            aiMeta: null,
            targetType: 'individuals',
            recipientIds: ['parent-1', 'user-2'],
            targetRole: null,
            conversationId: directConversationId,
            ...overrides
        };
    }

    function staffPayload(overrides = {}) {
        return {
            ...directPayload({
                senderId: 'coach-1',
                senderName: 'Coach One',
                senderEmail: 'coach@example.com',
                targetType: 'staff',
                recipientIds: [],
                targetRole: 'staff',
                conversationId: staffConversationId
            }),
            ...overrides
        };
    }

    it('allows canonical direct and staff payloads', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const coachDb = authedFirestore('coach-1', 'coach@example.com');
        const directWithoutStoredEmail = directPayload();
        delete directWithoutStoredEmail.senderEmail;

        await assertSucceeds(setDoc(messageRef(parentDb, directConversationId, 'valid-direct'), directPayload()));
        await assertSucceeds(setDoc(messageRef(parentDb, directConversationId, 'valid-direct-no-email'), directWithoutStoredEmail));
        await assertSucceeds(setDoc(messageRef(coachDb, staffConversationId, 'valid-staff'), staffPayload()));
    });

    it('allows bounded, scoped Firebase Storage attachment metadata', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const attachment = {
            type: 'image',
            url: 'https://firebasestorage.googleapis.com/v0/b/allplays-images/o/team-photo.jpg?alt=media',
            path: `team-photos/1700000000000_chat_team-1_${directConversationId}_parent-1_photo.jpg`,
            thumbnailUrl: null,
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            uploadedAt: Timestamp.now()
        };

        await assertSucceeds(setDoc(messageRef(parentDb, directConversationId, 'valid-media'), directPayload({
            text: '',
            attachments: [attachment]
        })));
    });

    it('denies spoofed, privileged, stale, extra-field, and mismatched creates', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const invalidPayloads = [
            directPayload({ senderId: 'user-2' }),
            directPayload({ senderEmail: 'spoofed@example.com' }),
            directPayload({ createdAt: Timestamp.fromMillis(1700000000000) }),
            directPayload({ deleted: true }),
            directPayload({ ai: true, aiName: 'ALL PLAYS' }),
            directPayload({ reactions: { heart: ['parent-1'] } }),
            directPayload({ recipientIds: ['parent-1'] }),
            directPayload({ conversationId: 'another-conversation' })
        ];

        for (const [index, payload] of invalidPayloads.entries()) {
            await assertFails(setDoc(messageRef(parentDb, directConversationId, `invalid-${index}`), payload));
        }
    });

    it('denies arbitrary attachment origins, paths, and oversized attachment metadata', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const baseAttachment = {
            type: 'image',
            url: 'https://firebasestorage.googleapis.com/v0/b/allplays-images/o/team-photo.jpg?alt=media',
            path: `team-photos/1700000000000_chat_team-1_${directConversationId}_parent-1_photo.jpg`,
            thumbnailUrl: null,
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            uploadedAt: Timestamp.now()
        };
        const invalidAttachments = [
            { ...baseAttachment, url: 'https://attacker.example/photo.jpg' },
            { ...baseAttachment, path: 'team-photos/unscoped-photo.jpg' },
            { ...baseAttachment, size: 5 * 1024 * 1024 + 1 }
        ];

        for (const [index, attachment] of invalidAttachments.entries()) {
            await assertFails(setDoc(messageRef(parentDb, directConversationId, `invalid-media-${index}`), directPayload({
                attachments: [attachment]
            })));
        }
    });

    it('allows bounded server-timestamp edits and rejects forged or oversized edits', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const ref = messageRef(parentDb, directConversationId, 'editable');
        await assertSucceeds(setDoc(ref, directPayload()));

        await assertSucceeds(updateDoc(ref, {
            text: 'Edited update',
            editedAt: serverTimestamp()
        }));
        await assertFails(updateDoc(ref, {
            text: 'Forged timestamp',
            editedAt: Timestamp.fromMillis(1700000000000)
        }));
        await assertFails(updateDoc(ref, {
            text: 'x'.repeat(10001),
            editedAt: serverTimestamp()
        }));
    });
});
