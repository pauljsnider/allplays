import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collection,
    deleteDoc,
    deleteField,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const indexes = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));

describe('private calendar credential rule contracts', () => {
    it('keeps both credential collections server-only and blocks credential aliases on team writes', () => {
        for (const collection of ['calendarTokens', 'privateCalendarSubscriptions']) {
            const block = rules.match(new RegExp(`match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n\\s*\\}`));
            expect(block?.[1]).toContain('allow read, write: if false;');
        }
        expect(rules).toContain('function hasNoClientCalendarCredentialFields(data)');
        expect(rules).toContain('function keepsCalendarCredentialFieldsImmutable()');
        expect(rules).toContain('hasNoClientCalendarCredentialFields(request.resource.data)');
        expect(rules).toContain('keepsCalendarCredentialFieldsImmutable();');
        for (const [collectionGroup, fieldPath] of [
            ['privateCalendarSubscriptions', 'uid'],
            ['privateCalendarSubscriptions', 'userId'],
            ['privateCalendarSubscriptions', 'createdBy'],
            ['calendarTokens', 'uid'],
            ['calendarTokens', 'userId'],
            ['calendarTokens', 'createdBy']
        ]) {
            expect(indexes.fieldOverrides).toContainEqual({
                collectionGroup,
                fieldPath,
                indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }]
            });
        }
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('private calendar credential rules-engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'demo-calendar-token-rules',
            firestore: { rules }
        });
    }, 30_000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await Promise.all([
                setDoc(doc(firestore, 'teams', 'team-1'), {
                    ownerId: 'owner-1',
                    name: 'Bears',
                    adminEmails: ['admin@example.com']
                }),
                setDoc(doc(firestore, 'teams', 'team-legacy'), {
                    ownerId: 'owner-1',
                    name: 'Legacy Bears',
                    adminEmails: [],
                    privateCalendarFeedUrl: 'https://example.test/private.ics?token=historical-secret'
                }),
                setDoc(doc(firestore, 'users', 'parent-1'), { parentTeamIds: ['team-1'] }),
                setDoc(doc(firestore, 'users', 'platform-admin'), { isAdmin: true }),
                setDoc(doc(firestore, 'teams', 'team-1', 'calendarTokens', 'lookup-1'), {
                    uid: 'owner-1',
                    tokenHash: 'hash-1',
                    active: true
                }),
                setDoc(doc(firestore, 'teams', 'team-1', 'privateCalendarSubscriptions', 'owner-1'), {
                    uid: 'owner-1',
                    rawToken: 'raw-secret',
                    active: true
                })
            ]);
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    function verifiedDb(uid, email = `${uid}@example.com`) {
        return testEnv.authenticatedContext(uid, {
            email,
            email_verified: true
        }).firestore();
    }

    it('denies credential reads and mutations even to owners, admins, parents, and platform admins', async () => {
        const callers = [
            testEnv.unauthenticatedContext().firestore(),
            verifiedDb('owner-1'),
            verifiedDb('admin-1', 'admin@example.com'),
            verifiedDb('parent-1'),
            verifiedDb('platform-admin'),
            verifiedDb('unrelated-user')
        ];

        for (const firestore of callers) {
            for (const [collectionName, documentId] of [
                ['calendarTokens', 'lookup-1'],
                ['privateCalendarSubscriptions', 'owner-1']
            ]) {
                const ref = doc(firestore, 'teams', 'team-1', collectionName, documentId);
                await assertFails(getDoc(ref));
                await assertFails(updateDoc(ref, { active: false }));
                await assertFails(deleteDoc(ref));
                await assertFails(setDoc(doc(firestore, 'teams', 'team-1', collectionName, 'new-record'), {
                    uid: 'owner-1',
                    active: true
                }));
                await assertFails(getDocs(collection(firestore, 'teams', 'team-1', collectionName)));
            }
        }
    });

    it('rejects credential aliases on team creation and update while preserving ordinary metadata writes', async () => {
        const ownerDb = verifiedDb('owner-1');
        const newOwnerDb = verifiedDb('new-owner');

        await assertFails(setDoc(doc(newOwnerDb, 'teams', 'team-new'), {
            ownerId: 'new-owner',
            name: 'Unsafe team',
            calendarSubscriptionToken: 'client-secret'
        }));
        await assertSucceeds(setDoc(doc(newOwnerDb, 'teams', 'team-safe'), {
            ownerId: 'new-owner',
            name: 'Safe team'
        }));
        await assertFails(updateDoc(doc(ownerDb, 'teams', 'team-1'), {
            privateCalendarFeedUrl: 'https://example.test/private.ics?token=client-secret'
        }));
        await assertSucceeds(updateDoc(doc(ownerDb, 'teams', 'team-1'), {
            name: 'Updated Bears'
        }));

        const legacyTeamRef = doc(ownerDb, 'teams', 'team-legacy');
        await assertSucceeds(updateDoc(legacyTeamRef, { name: 'Updated Legacy Bears' }));
        await assertFails(updateDoc(legacyTeamRef, { privateCalendarFeedUrl: deleteField() }));
        await assertFails(updateDoc(legacyTeamRef, {
            privateCalendarFeedUrl: 'https://example.test/private.ics?token=replacement-secret'
        }));
    });
});
