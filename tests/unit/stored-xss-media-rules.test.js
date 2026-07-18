import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const trustedPhoto = 'https://lh3.googleusercontent.com/a/trusted-photo';
const trustedDiagram = 'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/drills%2Fdiagram.png?alt=media&token=token-1';
const attackerFirebaseDiagram = 'https://firebasestorage.googleapis.com/v0/b/attacker-owned.firebasestorage.app/o/drills%2Fdiagram.svg?alt=media';
const trustedDiagramForms = [
    trustedDiagram,
    'https://firebasestorage.googleapis.com/v0/b/game-flow-c6311.firebasestorage.app/o/drills%2Fprimary.png?alt=media',
    'https://storage.googleapis.com/game-flow-img.firebasestorage.app/drills/path-form.png',
    'https://storage.googleapis.com/download/storage/v1/b/game-flow-c6311.firebasestorage.app/o/drills%2Frest-form.png?alt=media',
    'https://game-flow-img.firebasestorage.app/drills/direct-form.png'
];

describe('stored image URL Firestore rule contracts', () => {
    it('requires canonical trusted live-chat photos and compatibility-aware drill diagram updates', () => {
        expect(rules).toContain('function hasCanonicalLiveChatSenderPhoto(data)');
        expect(rules).toContain('hasCanonicalLiveChatSenderPhoto(data)');
        expect(rules).toContain('function hasValidDrillDiagramUrls(data)');
        expect(rules).toContain('function hasSafeDrillDiagramUrlUpdate()');
        expect(rules).toContain('nextDiagramUrls.hasOnly(existingDiagramUrls)');
        expect(rules).toContain('(game-flow-c6311|game-flow-img)[.]firebasestorage[.]app');
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('stored image URL rules engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-stored-xss-media-${Date.now()}`,
            firestore: { rules }
        });
    }, 30000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'teams/team-1'), {
                ownerId: 'owner-1',
                adminEmails: [],
                isPublic: true
            });
            await setDoc(doc(db, 'users/owner-1'), {
                displayName: 'Owner One',
                photoUrl: trustedPhoto
            });
            await setDoc(doc(db, 'teams/team-1/games/game-1'), {
                shareable: true,
                visibility: 'public'
            });
            await setDoc(doc(db, 'drillLibrary/legacy-drill'), {
                source: 'custom',
                teamId: 'team-1',
                createdBy: 'owner-1',
                title: 'Legacy drill',
                publishedToCommunity: false,
                diagramUrls: ['javascript:alert(1)', attackerFirebaseDiagram, 'https://legacy.example/diagram.png']
            });
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    function ownerDb(picture = trustedPhoto) {
        return testEnv.authenticatedContext('owner-1', {
            email: 'owner@example.com',
            name: 'Owner One',
            picture
        }).firestore();
    }

    function liveChatPayload(senderPhotoUrl) {
        return {
            text: 'Go team!',
            senderId: 'owner-1',
            senderName: 'Owner One',
            senderPhotoUrl,
            isAnonymous: false,
            createdAt: serverTimestamp()
        };
    }

    it('accepts a canonical trusted live-chat photo and the null fallback', async () => {
        const db = ownerDb();
        await assertSucceeds(setDoc(
            doc(db, 'teams/team-1/games/game-1/liveChat/trusted-photo'),
            liveChatPayload(trustedPhoto)
        ));
        await assertSucceeds(setDoc(
            doc(db, 'teams/team-1/games/game-1/liveChat/no-photo'),
            liveChatPayload(null)
        ));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await updateDoc(doc(context.firestore(), 'users/owner-1'), { photoUrl: trustedDiagram });
        });
        const firebasePhotoDb = ownerDb(trustedDiagram);
        await assertSucceeds(setDoc(
            doc(firebasePhotoDb, 'teams/team-1/games/game-1/liveChat/firebase-photo'),
            liveChatPayload(trustedDiagram)
        ));
    });

    it.each([
        'javascript:alert(1)',
        'data:image/svg+xml,<svg onload=alert(1)>',
        'https://attacker.example/avatar.png',
        'https://firebasestorage.googleapis.com/v0/b/attacker-owned.firebasestorage.app/o/avatar.png?alt=media',
        'https://storage.googleapis.com/attacker-owned.firebasestorage.app/avatar.png',
        'https://attacker-owned.firebasestorage.app/avatar.png',
        'https://firebasestorage.googleapis.com@attacker.example/avatar.png',
        'https://firebasestorage.googleapis.com/avatar.png" onerror="alert(1)',
        'https://firebasestorage.googleapis.com/avatar.png&#39; onerror=alert(1)'
    ])('rejects unsafe future live-chat photo write %s', async (payload) => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await updateDoc(doc(context.firestore(), 'users/owner-1'), { photoUrl: payload });
        });
        const db = ownerDb(payload);
        await assertFails(setDoc(
            doc(db, `teams/team-1/games/game-1/liveChat/rejected-${Math.random().toString(36).slice(2)}`),
            liveChatPayload(payload)
        ));
    });

    it('accepts only trusted Firebase diagram URLs on new drill writes', async () => {
        const db = ownerDb();
        await assertSucceeds(setDoc(doc(db, 'drillLibrary/safe-drill'), {
            source: 'custom',
            teamId: 'team-1',
            createdBy: 'owner-1',
            title: 'Safe drill',
            publishedToCommunity: false,
            diagramUrls: trustedDiagramForms
        }));
        await assertSucceeds(setDoc(doc(db, 'drillLibrary/no-diagram-drill'), {
            source: 'custom',
            teamId: 'team-1',
            createdBy: 'owner-1',
            title: 'No diagram drill',
            publishedToCommunity: false,
            diagramUrls: null
        }));

        for (const [index, payload] of [
            'javascript:alert(1)',
            'data:image/svg+xml,<svg onload=alert(1)>',
            'https://attacker.example/diagram.png',
            attackerFirebaseDiagram,
            'https://storage.googleapis.com/attacker-owned.firebasestorage.app/drills/diagram.svg',
            'https://attacker-owned.firebasestorage.app/drills/diagram.svg',
            'https://firebasestorage.googleapis.com@attacker.example/diagram.png',
            'https://firebasestorage.googleapis.com/diagram.png" onerror="alert(1)'
        ].entries()) {
            await assertFails(setDoc(doc(db, `drillLibrary/rejected-drill-${index}`), {
                source: 'custom',
                teamId: 'team-1',
                createdBy: 'owner-1',
                title: 'Rejected drill',
                publishedToCommunity: false,
                diagramUrls: [payload]
            }));
        }
    });

    it('preserves unrelated legacy updates and removal-only cleanup without admitting new unsafe URLs', async () => {
        const db = ownerDb();
        const legacyRef = doc(db, 'drillLibrary/legacy-drill');

        await assertSucceeds(updateDoc(legacyRef, { title: 'Legacy drill renamed' }));
        await assertSucceeds(updateDoc(legacyRef, { diagramUrls: ['https://legacy.example/diagram.png'] }));
        await assertFails(updateDoc(legacyRef, {
            diagramUrls: ['https://legacy.example/diagram.png', trustedDiagram]
        }));
        await assertSucceeds(updateDoc(legacyRef, { diagramUrls: [trustedDiagram] }));
    });
});
