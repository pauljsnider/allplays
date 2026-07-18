import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const appChatSource = readFileSync(new URL('../../apps/app/src/lib/chatService.ts', import.meta.url), 'utf8');
const appAiSource = readFileSync(new URL('../../apps/app/src/lib/chatAiService.ts', import.meta.url), 'utf8');
const chatPageSource = readFileSync(new URL('../../team-chat.html', import.meta.url), 'utf8');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('nested team chat message payload contracts', () => {
    it('validates the complete create shape, trusted sender fields, server time, targets, and media', () => {
        expect(rules).toContain('function isNestedChatMessageCreateValid(teamId, conversationId, conversationData, data)');
        expect(rules).toContain("data.keys().hasAll([\n               'text', 'senderId', 'attachments', 'createdAt', 'targetType'");
        expect(rules).toContain("data.keys().hasOnly([\n               'clientMessageId', 'text', 'senderId'");
        expect(rules).toContain('data.senderId == request.auth.uid');
        expect(rules).toContain('function hasCanonicalChatSenderPresentation(data)');
        expect(rules).toContain('hasCanonicalChatSenderPresentation(data)');
        expect(rules).toContain('data.senderEmail.lower() == request.auth.token.email.lower()');
        expect(rules).toContain('data.createdAt == request.time');
        expect(rules).toContain("data.get('editedAt', null) == null");
        expect(rules).toContain("data.get('deleted', false) == false");
        expect(rules).toContain("data.get('ai', false) == false");
        expect(rules).toContain("data.get('aiMeta', null) == null");
        expect(rules).toContain('function hasValidNestedChatAttachments(teamId, conversationId, data)');
        expect(rules).toContain('function isSafeNestedChatRegexSegment(value)');
        expect(rules).toContain('function isScopedNestedChatFallbackMediaPath(teamId, conversationId, value)');
        expect(rules).toContain("let pathSegments = value.split('/');");
        expect(rules).toContain('pathSegments[3] == conversationId');
        expect(rules).toContain("value.matches('[A-Za-z0-9_%:-]+')");
        const scopedMediaPathValidator = rules.slice(
            rules.indexOf('function isScopedNestedChatMediaPath'),
            rules.indexOf('function isValidNestedChatAttachment')
        );
        expect(scopedMediaPathValidator.indexOf('isScopedNestedChatFallbackMediaPath')).toBeLessThan(
            scopedMediaPathValidator.indexOf("value.matches('team-(photos|videos)")
        );
        const attachmentValidator = rules.slice(
            rules.indexOf('function isValidNestedChatAttachment'),
            rules.indexOf('function hasValidNestedChatAttachments')
        );
        expect(attachmentValidator).toContain("attachment.keys().hasOnly([\n               'type', 'url', 'path', 'thumbnailUrl', 'name', 'mimeType', 'size', 'uploadedAt'");
        for (const requiredField of ['type', 'url', 'path', 'thumbnailUrl', 'name', 'mimeType', 'size', 'uploadedAt']) {
            expect(attachmentValidator).toContain(`attachment.${requiredField}`);
        }
        expect(rules).toContain('data.attachments.size() <= 10');
        expect(rules).toContain('attachment.size <= 5 * 1024 * 1024');
        expect(rules).toContain("value.matches('https://firebasestorage[.]googleapis[.]com/.*')");
        const createValidator = rules.slice(
            rules.indexOf('function isNestedChatMessageCreateValid'),
            rules.indexOf('function isNestedChatMessageEditValid')
        );
        expect(createValidator.indexOf('hasValidNestedChatAttachments(teamId, conversationId, data)')).toBeLessThan(
            createValidator.indexOf('(data.text.size() > 0 || data.attachments.size() > 0)')
        );
        expect(rules).toContain('function isNestedChatMessageTargetValid(teamId, conversationId, conversationData, data)');
        expect(rules).toContain("conversationData.get('type', '') == 'group'");
        expect(rules).toContain('function hasValidNestedChatRecipientIds(conversationData, data)');
        expect(rules).toContain("conversationData.get('participantIds', []) is list");
        expect(rules).toContain('hasValidNestedChatRecipientIds(conversationData, data)');
        expect(rules).toContain("data.recipientIds == conversationData.get('participantIds', [])");

        const editTargetValidator = rules.slice(
            rules.indexOf('function isNestedChatMessageEditTargetValid'),
            rules.indexOf('function isNestedChatMessageCreateValid')
        );
        expect(editTargetValidator).toContain('isNestedChatMessageTargetValid(teamId, conversationId, conversationData, data)');
        expect(editTargetValidator).toContain('hasValidLegacyNestedChatRecipientIds(conversationData, data)');
        expect(editTargetValidator).toContain('data.conversationId == conversationId');
        expect(rules).toContain('data.recipientIds.hasOnly(participantIds)');
        expect(rules).toContain('data.senderId in participantIds');
        expect(rules).toContain('!(data.senderId in data.recipientIds)');

        const nestedTargetValidator = rules.slice(
            rules.indexOf('function isNestedChatMessageTargetValid'),
            rules.indexOf('function isNestedChatMessageEditTargetValid')
        );
        expect(nestedTargetValidator).not.toContain('isIndividualChatMessage(teamId, data)');

        const createTargetValidator = rules.slice(
            rules.indexOf('function isNestedChatMessageCreateValid'),
            rules.indexOf('function isNestedChatMessageEditValid')
        );
        expect(createTargetValidator).toContain('isNestedChatMessageTargetValid(teamId, conversationId, conversationData, data)');
        expect(nestedTargetValidator).not.toContain("conversationData.get('type', '') == 'direct'");
        expect(createTargetValidator).not.toContain('isNestedChatMessageEditTargetValid');

        expect(rules).toContain('function isAcceptedFriendDirectConversation(teamId, data)');
        expect(rules).toContain("friendship.get('status', '') == 'accepted'");
        expect(rules).toContain("teamId in friendship.get('sharedTeamIds', [])");
        expect(rules).toContain('isDirectConversationCreateAuthorized(teamId, request.resource.data)');
        expect(rules).toContain("request.auth.uid in request.resource.data.get('directUserIds', [])");

        const nestedMessageRules = rules.slice(
            rules.indexOf('match /chatConversations/{conversationId} {'),
            rules.indexOf('// Server-only dedup log')
        );
        expect(nestedMessageRules).toContain('request.resource.data.diff(resource.data).affectedKeys()\n                               .hasOnly([\'text\', \'editedAt\'])');
        expect(nestedMessageRules).toContain('resource.data.senderId == request.auth.uid');
        expect(nestedMessageRules).toContain('isNestedChatMessageEditTargetValid(');
    });

    it('hardens legacy full-team creates without coupling them to conversation documents', () => {
        const legacyStart = rules.indexOf('match /chatMessages/{messageId} {');
        const conversationStart = rules.indexOf('match /chatConversations/{conversationId} {');
        const legacyBlock = rules.slice(legacyStart, conversationStart);
        const legacyValidator = rules.slice(
            rules.indexOf('function isLegacyFullTeamChatMessageCreateValid'),
            rules.indexOf('function isNestedChatMessageTargetValid')
        );

        expect(legacyBlock).toContain('isLegacyFullTeamChatMessageCreateValid(teamId, request.resource.data);');
        expect(legacyBlock).not.toContain('isNestedChatMessageCreateValid');
        expect(legacyValidator).toContain("hasValidNestedChatAttachments(teamId, 'team', data)");
        expect(legacyValidator).toContain('hasValidLegacyChatImageMetadata(data)');
        expect(legacyValidator).toContain('data.createdAt == request.time');
        expect(legacyValidator).toContain("data.get('ai', false) == false");
        expect(legacyValidator).toContain("data.get('aiMeta', null) == null");
        expect(legacyValidator).toContain("data.get('conversationId', null) == null");
        expect(legacyValidator).toContain('isFullTeamChatMessage(data)');
        expect(legacyValidator).not.toContain('conversationData');
    });

    it('writes server-authored timestamps and canonical conversation participants from every client path', () => {
        expect(dbSource).toContain('const createdAt = serverTimestamp();');
        expect(dbSource).toContain('const attachmentUploadedAt = Timestamp.now();');
        expect(dbSource).toContain('uploadedAt: attachmentUploadedAt');
        expect(dbSource).toContain('editedAt: serverTimestamp()');
        expect(dbSource).toContain('imageUrl: null,\n        imagePath: null,');
        expect(appChatSource).toContain('const attachmentUploadedAt = new Date();');
        expect(appChatSource).toContain('attachments: attachments.map((attachment) => ({ ...attachment, uploadedAt: attachmentUploadedAt }))');
        expect(appChatSource).toContain("serverTimestampFields: ['createdAt']");
        expect(appChatSource).toContain("serverTimestampFields: ['editedAt']");
        expect(appChatSource).toContain("setToServerValue: 'REQUEST_TIME'");
        expect(appChatSource).toContain('recipientIds: Array.isArray(createdConversation.participantIds) ? createdConversation.participantIds : participantIds');
        expect(chatPageSource).toContain('recipientIds: Array.isArray(conversation.participantIds) ? conversation.participantIds : participantIds');
        expect(chatPageSource).toContain("httpsCallable(functions, 'sendAuthorizedDirectMessage')");
        expect(chatPageSource).toContain("if (conversation?.type === 'direct')");
        expect(chatPageSource).toContain('return postChatMessage(teamId, message);');
        expect(functionsSource).toContain('const recipientParticipantIds = conversation.participantIds.filter(');
        expect(functionsSource).toContain('(participantId) => normalizeDirectChatUserId(participantId) !== caller.uid');
        expect(functionsSource).toContain('recipientIds: recipientParticipantIds');
        expect(functionsSource).toContain("rawType.startsWith('video/') || rawMimeType.startsWith('video/')");
        expect(functionsSource).toContain("rawType.startsWith('image/') || rawMimeType.startsWith('image/')");
    });

    it('does not persist privileged AI identity fields from client conversations', () => {
        expect(dbSource).toContain('ai: false,\n        aiName: null,\n        aiQuestion: null,\n        aiMeta: null,');
        expect(appChatSource).toContain('ai: false,\n    aiName: null,\n    aiQuestion: null,\n    aiMeta: null,');
        expect(appAiSource).toContain('const answerText = `ALL PLAYS\\n\\n${responseText}`');
        expect(appAiSource).toContain("selectedConversation?.type === 'direct'");
        expect(appAiSource).toContain('await sendAuthorizedDirectMessage({');
        expect(appAiSource).toContain('text: answerText');
        expect(appAiSource).toContain('ai: false');
        expect(appAiSource).toContain('aiName: null');
        expect(appAiSource).toContain('aiMeta: null');
        expect(chatPageSource).toContain('text: `ALL PLAYS\\n\\n${responseText}`');
        expect(chatPageSource).toContain('ai: false');
        expect(chatPageSource).toContain('aiName: null');
        expect(chatPageSource).toContain('aiMeta: null');
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('nested team chat message rules engine coverage', () => {
    let testEnv;
    const directConversationId = 'direct_parent-1__user-2';
    const friendDirectConversationId = 'direct_parent-1__user%3Auser-2';
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
                ownerId: 'owner-1',
                adminEmails: ['coach@example.com']
            });
            await setDoc(doc(firestore, 'users/owner-1'), {
                email: 'owner@example.com',
                isAdmin: false,
                parentTeamIds: []
            });
            await setDoc(doc(firestore, 'users/coach-1'), {
                email: 'coach@example.com',
                fullName: 'Coach One',
                photoUrl: 'https://example.com/coach.jpg',
                isAdmin: false,
                parentTeamIds: []
            });
            await setDoc(doc(firestore, 'users/global-1'), {
                email: 'global@example.com',
                isAdmin: true,
                parentTeamIds: []
            });
            await setDoc(doc(firestore, 'users/parent-1'), {
                email: 'parent@example.com',
                fullName: 'Pat Parent',
                photoUrl: 'https://example.com/parent.jpg',
                isAdmin: false,
                parentTeamIds: ['team-1']
            });
            await setDoc(doc(firestore, 'users/user-2'), {
                email: 'user2@example.com',
                fullName: 'Other Parent',
                photoUrl: 'https://example.com/other.jpg',
                isAdmin: false,
                parentTeamIds: ['team-1']
            });
            await setDoc(doc(firestore, 'users/attacker-1'), {
                email: 'attacker@example.com',
                isAdmin: false,
                parentTeamIds: ['team-1']
            });
            await setDoc(doc(firestore, 'friendships/parent-1__user-2'), {
                requesterId: 'parent-1',
                recipientId: 'user-2',
                memberIds: ['parent-1', 'user-2'],
                sharedTeamIds: ['team-1'],
                blockedBy: [],
                status: 'accepted'
            });
            await setDoc(doc(firestore, `teams/team-1/chatConversations/${directConversationId}`), {
                type: 'group',
                participantIds: ['parent-1', 'user-2'],
                participantRoles: [],
                mutedBy: []
            });
            await setDoc(doc(firestore, `teams/team-1/chatConversations/${friendDirectConversationId}`), {
                type: 'direct',
                participantIds: ['parent-1', 'user:user-2'],
                participantRoles: [],
                directAccess: 'accepted_friend',
                directUserIds: ['parent-1', 'user-2'],
                friendshipId: 'parent-1__user-2',
                initiatedBy: null,
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

    function legacyMessageRef(firestore, messageId) {
        return doc(firestore, `teams/team-1/chatMessages/${messageId}`);
    }

    function legacyPayload(overrides = {}) {
        return {
            clientMessageId: null,
            text: 'Full team update',
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
            targetType: 'full_team',
            recipientIds: [],
            targetRole: null,
            conversationId: null,
            ...overrides
        };
    }

    function directConversationPayload(overrides = {}) {
        return {
            type: 'direct',
            name: 'Private conversation',
            participantIds: ['parent-1', 'user:user-2'],
            participantRoles: [],
            lastMessageAt: null,
            mutedBy: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            directAccess: 'accepted_friend',
            directUserIds: ['parent-1', 'user-2'],
            friendshipId: 'parent-1__user-2',
            initiatedBy: null,
            ...overrides
        };
    }

    function firebaseMediaUrl(path, bucket = 'game-flow-img.firebasestorage.app') {
        const encodedPath = encodeURIComponent(path);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
    }

    function legacyAttachment(overrides = {}) {
        const path = overrides.path || 'team-photos/1700000000000_chat_team-1_team_parent-1_photo.jpg';
        return {
            type: 'image',
            url: firebaseMediaUrl(path),
            path,
            thumbnailUrl: null,
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            uploadedAt: Timestamp.now(),
            ...overrides,
            path
        };
    }

    function fallbackAttachment(conversationId = staffConversationId, overrides = {}) {
        const path = overrides.path || `stat-sheets/team-chat/team-1/${conversationId}/coach-1/photo.jpg`;
        return legacyAttachment({
            path,
            url: firebaseMediaUrl(path, 'game-flow-c6311.firebasestorage.app'),
            ...overrides
        });
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

    it('allows canonical targeted-group and staff payloads', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const coachDb = authedFirestore('coach-1', 'coach@example.com');
        const directWithoutStoredEmail = directPayload();
        delete directWithoutStoredEmail.senderEmail;

        await assertSucceeds(setDoc(messageRef(parentDb, directConversationId, 'valid-direct'), directPayload()));
        await assertSucceeds(setDoc(messageRef(parentDb, directConversationId, 'valid-direct-photo'), directPayload({
            senderPhotoUrl: 'https://example.com/parent.jpg'
        })));
        await assertSucceeds(setDoc(messageRef(parentDb, directConversationId, 'valid-direct-null-presentation'), directPayload({
            senderName: null,
            senderPhotoUrl: null
        })));
        await assertSucceeds(setDoc(messageRef(parentDb, directConversationId, 'valid-direct-no-email'), directWithoutStoredEmail));
        await assertSucceeds(setDoc(messageRef(coachDb, staffConversationId, 'valid-staff'), staffPayload()));
    });

    it('denies direct-message client writes so the authorization callable owns that path', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        await assertFails(setDoc(messageRef(parentDb, friendDirectConversationId, 'direct-client-write'), directPayload({
            recipientIds: ['parent-1', 'user:user-2'],
            conversationId: friendDirectConversationId
        })));
    });

    it('authorizes direct conversation creation from current friendship or team-admin state', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const ownerDb = authedFirestore('owner-1', 'owner@example.com');

        await assertSucceeds(setDoc(
            doc(parentDb, 'teams/team-1/chatConversations/direct-new-friend'),
            directConversationPayload()
        ));
        await assertFails(setDoc(
            doc(parentDb, 'teams/team-1/chatConversations/direct-forged-admin'),
            directConversationPayload({
                participantIds: ['parent-1', 'user:owner-1'],
                directAccess: 'team_admin',
                directUserIds: ['owner-1', 'parent-1'],
                friendshipId: null,
                initiatedBy: 'parent-1'
            })
        ));
        await assertSucceeds(setDoc(
            doc(ownerDb, 'teams/team-1/chatConversations/direct-owner-parent'),
            directConversationPayload({
                participantIds: ['owner-1', 'user:parent-1'],
                directAccess: 'team_admin',
                directUserIds: ['owner-1', 'parent-1'],
                friendshipId: null,
                initiatedBy: 'owner-1'
            })
        ));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await updateDoc(doc(context.firestore(), 'friendships/parent-1__user-2'), { status: 'removed' });
        });
        await assertFails(setDoc(
            doc(parentDb, 'teams/team-1/chatConversations/direct-revoked-friend'),
            directConversationPayload()
        ));
    });

    it('keeps accepted-friend direct conversations private from nonparticipant team admins', async () => {
        const conversationPath = `teams/team-1/chatConversations/${friendDirectConversationId}`;
        const coachDb = authedFirestore('coach-1', 'coach@example.com');
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const friendDb = authedFirestore('user-2', 'user2@example.com');

        await assertFails(getDoc(doc(coachDb, conversationPath)));
        await assertSucceeds(getDoc(doc(parentDb, conversationPath)));
        await assertSucceeds(getDoc(doc(friendDb, conversationPath)));
        await assertFails(getDocs(query(
            collection(coachDb, 'teams/team-1/chatConversations'),
            where('directAccess', '==', 'accepted_friend')
        )));
        await assertSucceeds(getDocs(query(
            collection(parentDb, 'teams/team-1/chatConversations'),
            where('directUserIds', 'array-contains', 'parent-1')
        )));
    });

    it('lets only a direct participant upgrade legacy direct authorization metadata', async () => {
        const conversationId = 'legacy-direct-upgrade';
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), `teams/team-1/chatConversations/${conversationId}`), {
                type: 'direct',
                name: 'Legacy private conversation',
                participantIds: ['parent-1', 'user:user-2'],
                participantRoles: [],
                mutedBy: [],
                createdAt: Timestamp.fromMillis(1700000000000),
                updatedAt: Timestamp.fromMillis(1700000000000)
            });
        });
        const upgrade = {
            directAccess: 'accepted_friend',
            directUserIds: ['parent-1', 'user-2'],
            friendshipId: 'parent-1__user-2',
            initiatedBy: null,
            updatedAt: serverTimestamp()
        };

        await assertSucceeds(getDocs(query(
            collection(authedFirestore('parent-1', 'parent@example.com'), 'teams/team-1/chatConversations'),
            where('participantIds', 'array-contains', 'parent-1'),
            where('type', '==', 'direct')
        )));

        await assertFails(updateDoc(
            doc(authedFirestore('attacker-1', 'attacker@example.com'), `teams/team-1/chatConversations/${conversationId}`),
            upgrade
        ));
        await assertSucceeds(updateDoc(
            doc(authedFirestore('parent-1', 'parent@example.com'), `teams/team-1/chatConversations/${conversationId}`),
            upgrade
        ));
    });

    it('lets only team staff repair legacy canonical metadata before reading staff messages', async () => {
        const legacyCreatedAt = Timestamp.fromMillis(1700000000000);
        const seedConversation = async (conversationId, overrides = {}) => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), `teams/team-1/chatConversations/${conversationId}`), {
                    type: 'group',
                    name: 'Staff only',
                    participantIds: ['coach-1'],
                    participantRoles: ['staff', 'coach'],
                    mutedBy: [],
                    createdAt: legacyCreatedAt,
                    updatedAt: Timestamp.now(),
                    ...overrides
                });
            });
        };
        const canonicalPayload = (overrides = {}) => ({
                type: 'group',
                name: 'Staff only',
                participantIds: [],
                participantRoles: ['staff'],
                mutedBy: [],
                createdAt: legacyCreatedAt,
                updatedAt: serverTimestamp(),
                ...overrides
        });

        await seedConversation(staffConversationId);
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(messageRef(firestore, staffConversationId, 'legacy-staff-message'), {
                text: 'Staff update'
            });
        });

        const adminDb = authedFirestore('coach-1', 'coach@example.com');
        const ownerDb = authedFirestore('owner-1', 'owner@example.com');
        const globalAdminDb = authedFirestore('global-1', 'global@example.com');
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const adminConversationRef = doc(adminDb, `teams/team-1/chatConversations/${staffConversationId}`);
        const ownerConversationRef = doc(ownerDb, `teams/team-1/chatConversations/${staffConversationId}`);
        const globalAdminConversationRef = doc(globalAdminDb, `teams/team-1/chatConversations/${staffConversationId}`);
        const parentConversationRef = doc(parentDb, `teams/team-1/chatConversations/${staffConversationId}`);

        await assertSucceeds(getDoc(adminConversationRef));
        await assertSucceeds(getDoc(ownerConversationRef));
        await assertSucceeds(getDoc(globalAdminConversationRef));
        await assertFails(getDoc(parentConversationRef));
        await assertFails(setDoc(parentConversationRef, canonicalPayload()));
        await assertFails(getDoc(messageRef(adminDb, staffConversationId, 'legacy-staff-message')));
        await assertFails(getDocs(collection(adminDb, `teams/team-1/chatConversations/${staffConversationId}/chatMessages`)));
        await assertFails(setDoc(adminConversationRef, canonicalPayload({ participantRoles: ['staff', 'coach'] })));
        await assertFails(setDoc(adminConversationRef, canonicalPayload({ unexpected: true })));

        await assertSucceeds(setDoc(adminConversationRef, canonicalPayload()));
        await assertSucceeds(getDoc(messageRef(adminDb, staffConversationId, 'legacy-staff-message')));
        await assertSucceeds(getDocs(collection(adminDb, `teams/team-1/chatConversations/${staffConversationId}/chatMessages`)));
        await assertFails(getDoc(messageRef(parentDb, staffConversationId, 'legacy-staff-message')));

        await seedConversation('legacy_staff');
        await assertFails(getDoc(doc(adminDb, 'teams/team-1/chatConversations/legacy_staff')));

        await seedConversation(staffConversationId, { participantRoles: ['coach'] });
        await assertFails(getDoc(adminConversationRef));
    });

    it('allows legacy full-team text and exact scoped Firebase Storage uploads', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const attachment = legacyAttachment();

        await assertSucceeds(setDoc(legacyMessageRef(parentDb, 'valid-text'), legacyPayload()));
        await assertSucceeds(setDoc(legacyMessageRef(parentDb, 'valid-canonical-photo'), legacyPayload({
            senderPhotoUrl: 'https://example.com/parent.jpg'
        })));
        await assertSucceeds(setDoc(legacyMessageRef(parentDb, 'valid-null-presentation'), legacyPayload({
            senderName: null,
            senderPhotoUrl: null
        })));
        await assertSucceeds(setDoc(legacyMessageRef(parentDb, 'valid-media'), legacyPayload({
            text: '',
            attachments: [attachment]
        })));
    });

    it('allows canonical double-encoded percent segments without legacy duplicate URL fields', async () => {
        const coachDb = authedFirestore('coach-1', 'coach@example.com');
        const attachment = fallbackAttachment();

        expect(attachment.url).toContain('group_role%253Astaff');
        await assertSucceeds(setDoc(messageRef(coachDb, staffConversationId, 'valid-percent-path'), staffPayload({
            text: '',
            attachments: [attachment]
        })));
    });

    it('denies forged legacy origins, paths, metadata, senders, AI fields, and timestamps', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const validAttachment = legacyAttachment();
        const invalidPayloads = [
            legacyPayload({ attachments: [legacyAttachment({ url: 'https://attacker.example/photo.jpg' })] }),
            legacyPayload({
                attachments: [validAttachment],
                imageUrl: validAttachment.url,
                imagePath: validAttachment.path,
                imageName: validAttachment.name,
                imageType: validAttachment.mimeType,
                imageSize: validAttachment.size
            }),
            legacyPayload({ attachments: [legacyAttachment({ path: 'team-photos/unscoped-photo.jpg' })] }),
            legacyPayload({ attachments: [legacyAttachment({ size: 5 * 1024 * 1024 + 1 })] }),
            legacyPayload({ unexpectedField: true }),
            legacyPayload({ senderId: 'user-2' }),
            legacyPayload({ senderName: 'Other Parent' }),
            legacyPayload({ senderPhotoUrl: 'https://example.com/other.jpg' }),
            legacyPayload({ senderPhotoUrl: 'https://attacker.example/tracker.gif' }),
            legacyPayload({ ai: true, aiName: 'ALL PLAYS' }),
            legacyPayload({ aiMeta: { forged: true } }),
            legacyPayload({ createdAt: Timestamp.fromMillis(1700000000000) }),
            legacyPayload({ targetType: 'individuals', recipientIds: ['user-2'] }),
            legacyPayload({ conversationId: 'team' })
        ];

        for (const [index, payload] of invalidPayloads.entries()) {
            await assertFails(setDoc(legacyMessageRef(parentDb, `invalid-legacy-${index}`), payload));
        }
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
            directPayload({ text: '', attachments: [] }),
            directPayload({ senderId: 'user-2' }),
            directPayload({ senderEmail: 'spoofed@example.com' }),
            directPayload({ senderName: 'Other Parent' }),
            directPayload({ senderPhotoUrl: 'https://example.com/other.jpg' }),
            directPayload({ senderPhotoUrl: 'https://attacker.example/tracker.gif' }),
            directPayload({ createdAt: Timestamp.fromMillis(1700000000000) }),
            directPayload({ deleted: true }),
            directPayload({ ai: true, aiName: 'ALL PLAYS' }),
            directPayload({ reactions: { heart: ['parent-1'] } }),
            directPayload({ recipientIds: ['parent-1'] }),
            directPayload({ recipientIds: ['user-2'] }),
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
        const missingRequiredField = { ...baseAttachment };
        delete missingRequiredField.uploadedAt;
        const invalidAttachments = [
            { ...baseAttachment, url: 'https://attacker.example/photo.jpg' },
            { ...baseAttachment, path: 'team-photos/unscoped-photo.jpg' },
            { ...baseAttachment, size: 5 * 1024 * 1024 + 1 },
            missingRequiredField,
            { ...baseAttachment, unexpectedField: true }
        ];

        for (const [index, attachment] of invalidAttachments.entries()) {
            await assertFails(setDoc(messageRef(parentDb, directConversationId, `invalid-media-${index}`), directPayload({
                attachments: [attachment]
            })));
        }
    });

    it('denies attachment-only messages when the conversation id is not safe to interpolate into path regexes', async () => {
        const unsafeConversationId = 'direct_parent-1__user-2.*';
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), `teams/team-1/chatConversations/${unsafeConversationId}`), {
                type: 'direct',
                participantIds: ['parent-1', 'user-2'],
                participantRoles: [],
                mutedBy: []
            });
        });

        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const attachment = {
            type: 'image',
            url: 'https://firebasestorage.googleapis.com/v0/b/allplays-images/o/team-photo.jpg?alt=media',
            path: 'stat-sheets/team-chat/team-1/direct_parent-1__user-2x/parent-1/photo.jpg',
            thumbnailUrl: null,
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            uploadedAt: Timestamp.now()
        };

        await assertFails(setDoc(messageRef(parentDb, unsafeConversationId, 'unsafe-conversation-media'), directPayload({
            text: '',
            attachments: [attachment],
            conversationId: unsafeConversationId
        })));
    });

    it('allows exact-segment fallback paths for dotted email-derived conversation ids', async () => {
        const emailConversationId = 'direct_email%3Aparent.name%40example.com__user-2';
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), `teams/team-1/chatConversations/${emailConversationId}`), {
                type: 'group',
                participantIds: ['parent-1', 'user-2'],
                participantRoles: [],
                mutedBy: []
            });
        });

        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const attachment = {
            type: 'image',
            url: 'https://firebasestorage.googleapis.com/v0/b/allplays-images/o/team-photo.jpg?alt=media',
            path: `stat-sheets/team-chat/team-1/${emailConversationId}/parent-1/photo.jpg`,
            thumbnailUrl: null,
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            uploadedAt: Timestamp.now()
        };

        await assertSucceeds(setDoc(messageRef(parentDb, emailConversationId, 'valid-dotted-conversation-media'), directPayload({
            text: '',
            attachments: [attachment],
            conversationId: emailConversationId
        })));
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

    it('allows text-only edits of legitimate legacy targets that omitted the sender', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const legacyRef = messageRef(parentDb, directConversationId, 'legacy-editable');
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(messageRef(context.firestore(), directConversationId, 'legacy-editable'), directPayload({
                recipientIds: ['user-2'],
                createdAt: Timestamp.now()
            }));
        });

        await assertSucceeds(updateDoc(legacyRef, {
            text: 'Edited legacy update',
            editedAt: serverTimestamp()
        }));
    });

    it('allows senders to edit callable-authored direct messages addressed to the other participant', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const prefixedParticipantDb = authedFirestore('user-2', 'user2@example.com');
        const callableMessageRef = messageRef(parentDb, friendDirectConversationId, 'callable-editable');
        const prefixedSenderMessageRef = messageRef(prefixedParticipantDb, friendDirectConversationId, 'callable-prefixed-sender-editable');
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(messageRef(context.firestore(), friendDirectConversationId, 'callable-editable'), directPayload({
                recipientIds: ['user:user-2'],
                conversationId: friendDirectConversationId,
                createdAt: Timestamp.now()
            }));
            await setDoc(messageRef(context.firestore(), friendDirectConversationId, 'callable-prefixed-sender-editable'), directPayload({
                senderId: 'user-2',
                senderEmail: 'user2@example.com',
                recipientIds: ['parent-1'],
                conversationId: friendDirectConversationId,
                createdAt: Timestamp.now()
            }));
        });

        await assertSucceeds(updateDoc(callableMessageRef, {
            text: 'Edited direct update',
            editedAt: serverTimestamp()
        }));
        await assertSucceeds(updateDoc(prefixedSenderMessageRef, {
            text: 'Edited reply from prefixed participant',
            editedAt: serverTimestamp()
        }));
    });

    it('keeps legacy edit compatibility scoped to the sender, conversation, and immutable target fields', async () => {
        const parentDb = authedFirestore('parent-1', 'parent@example.com');
        const otherParticipantDb = authedFirestore('user-2', 'user2@example.com');
        const legacyRef = messageRef(parentDb, directConversationId, 'legacy-protected');
        const unsafeLegacyRef = messageRef(parentDb, directConversationId, 'legacy-unsafe-target');
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(messageRef(context.firestore(), directConversationId, 'legacy-protected'), directPayload({
                recipientIds: ['user-2'],
                createdAt: Timestamp.now()
            }));
            await setDoc(messageRef(context.firestore(), directConversationId, 'legacy-unsafe-target'), directPayload({
                recipientIds: ['outsider-1'],
                createdAt: Timestamp.now()
            }));
        });

        await assertFails(updateDoc(messageRef(otherParticipantDb, directConversationId, 'legacy-protected'), {
            text: 'Edited by another participant',
            editedAt: serverTimestamp()
        }));
        await assertFails(updateDoc(legacyRef, {
            text: 'Mutated recipients',
            editedAt: serverTimestamp(),
            recipientIds: ['parent-1', 'user-2']
        }));
        await assertFails(updateDoc(legacyRef, {
            text: 'Mutated conversation',
            editedAt: serverTimestamp(),
            conversationId: 'another-conversation'
        }));
        await assertFails(updateDoc(unsafeLegacyRef, {
            text: 'Unsafe legacy target',
            editedAt: serverTimestamp()
        }));
    });
});
