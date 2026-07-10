import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const storageRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
const privilegedTeamMediaGrantFields = ['teamMediaUploadTeamIds', 'mediaUploadTeamIds'];
const privilegedMembershipFields = ['parentOf', 'parentTeamIds', 'parentPlayerKeys', 'playerKeys', 'coachOf'];

function ownerProfileCreateWouldBeAllowed(data) {
    return data.isAdmin !== true &&
        !privilegedMembershipFields.some((field) => Object.hasOwn(data, field)) &&
        !privilegedTeamMediaGrantFields.some((field) => Object.hasOwn(data, field));
}

function ownerProfileUpdateWouldBeAllowed(before, after) {
    const affectedKeys = new Set([
        ...Object.keys(before).filter((key) => before[key] !== after[key]),
        ...Object.keys(after).filter((key) => before[key] !== after[key])
    ]);

    return !affectedKeys.has('isAdmin') &&
        !privilegedMembershipFields.some((field) => affectedKeys.has(field)) &&
        !privilegedTeamMediaGrantFields.some((field) => affectedKeys.has(field));
}

function hasTeamMediaUploadGrant(profile, teamId) {
    return (profile.teamMediaUploadTeamIds ?? []).includes(teamId) ||
        (profile.mediaUploadTeamIds ?? []).includes(teamId);
}

function isTeamMediaCoachWouldBeAllowed({ signedIn = true, profile = {}, teamExists = true, email = '', adminEmails = [] }, teamId) {
    return Boolean(
        signedIn &&
        teamExists &&
        email &&
        adminEmails.includes(email.toLowerCase()) &&
        (profile.coachOf ?? []).includes(teamId)
    );
}

describe('team media Firestore rules', () => {
    it('defines team media folders and items under teams', () => {
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('match /mediaItems/{itemId}');
    });

    it('blocks owners from self-writing Team Media capability fields on profiles', () => {
        expect(rules).toContain("return ['parentOf', 'parentTeamIds', 'parentPlayerKeys', 'playerKeys', 'coachOf'];");
        expect(rules).toContain("function teamMediaUploadGrantFields() {");
        expect(rules).toContain("return ['teamMediaUploadTeamIds', 'mediaUploadTeamIds'];");
        expect(rules).toContain('!data.keys().hasAny(teamMediaUploadGrantFields())');
        expect(rules).toContain('!request.resource.data.diff(resource.data).affectedKeys().hasAny(teamMediaUploadGrantFields())');

        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User' })).toBe(true);
        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Fake Coach', coachOf: ['team-a'] })).toBe(false);
        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User', teamMediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User', mediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'New' })).toBe(true);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'Old', coachOf: ['team-a'] })).toBe(false);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'Old', teamMediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'Old', mediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old', teamMediaUploadTeamIds: ['team-a'] }, { displayName: 'Old' })).toBe(false);
    });

    it('models denied self-grants as unable to unlock team media creates', () => {
        const nonMemberProfile = { uid: 'non-member' };
        const selfGrantedProfile = { uid: 'non-member', coachOf: ['team-a'], teamMediaUploadTeamIds: ['team-a'], mediaUploadTeamIds: ['team-a'] };

        expect(ownerProfileUpdateWouldBeAllowed(nonMemberProfile, selfGrantedProfile)).toBe(false);
        expect(hasTeamMediaUploadGrant(nonMemberProfile, 'team-a')).toBe(false);
        expect(hasTeamMediaUploadGrant({ uid: 'contributor', teamMediaUploadTeamIds: ['team-a'] }, 'team-a')).toBe(true);
        expect(hasTeamMediaUploadGrant({ uid: 'legacy-contributor', mediaUploadTeamIds: ['team-a'] }, 'team-a')).toBe(true);
    });

    it('requires admin-email provenance before linked coaches can manage media', () => {
        const mediaRulesStart = rules.indexOf('match /mediaFolders/{folderId}');
        const mediaRulesEnd = rules.indexOf('// Chat messages subcollection', mediaRulesStart);
        const mediaRules = rules.slice(mediaRulesStart, mediaRulesEnd);

        expect(rules).toContain('function isTeamMediaCoach(teamId) {');
        expect(rules).toContain("teamId in get(userPath).data.get('coachOf', [])");
        expect(rules).toContain("request.auth.token.email.lower() in team.get('adminEmails', [])");
        expect(storageRules).toContain('function isTeamMediaCoach(teamId) {');
        expect(storageRules).toContain("teamId in firestore.get(userPath).data.get('coachOf', [])");
        expect(storageRules).toContain("request.auth.token.email.lower() in team.get('adminEmails', [])");
        expect(rules).toContain('function canManageTeamMedia(teamId) {');
        expect(rules).toContain('return isTeamOwnerOrAdmin(teamId) || isTeamMediaCoach(teamId);');
        expect(isTeamMediaCoachWouldBeAllowed({
            profile: { coachOf: ['team-a'] },
            email: 'coach@example.com',
            adminEmails: ['coach@example.com']
        }, 'team-a')).toBe(true);
        expect(isTeamMediaCoachWouldBeAllowed({
            profile: { coachOf: ['team-a'] },
            email: 'forged@example.com',
            adminEmails: []
        }, 'team-a')).toBe(false);
        expect(isTeamMediaCoachWouldBeAllowed({
            profile: { coachOf: [] },
            email: 'coach@example.com',
            adminEmails: ['coach@example.com']
        }, 'team-a')).toBe(false);
        expect(mediaRules).toContain('allow read: if canReadTeamMediaFolder(teamId, resource.data);');
        expect(mediaRules).toContain('allow create, delete: if canManageTeamMedia(teamId);');
        expect(mediaRules).toContain('allow update: if canManageTeamMedia(teamId) || isTeamMediaUploadCounterUpdate(teamId);');
        expect(mediaRules).toContain('allow read: if canReadTeamMediaItem(teamId, resource.data);');
        expect(mediaRules).toContain('allow create: if canManageTeamMedia(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);');
        expect(mediaRules).toContain('allow update: if canManageTeamMedia(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);');
        expect(rules).toContain("teamId in get(userPath).data.get('teamMediaUploadTeamIds', [])");
        expect(rules).toContain("teamId in get(userPath).data.get('mediaUploadTeamIds', [])");
        expect(rules).toContain('function isTeamMediaUploadCounterUpdate(teamId) {');
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['nextMediaOrder', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.get('nextMediaOrder', 0) == resource.data.get('nextMediaOrder', 0) + 1");
        expect(rules).toContain('return hasTeamMediaUploadGrant(teamId) &&');
        expect(rules).toContain('canUploadTeamMediaFolder(teamId, data.folderId)');
        expect(rules).toContain("data.type in ['photo', 'file']");
        expect(rules).toContain('isAllowedTeamMediaUploadType(data.mimeType)');
        expect(mediaRules).toContain('allow delete: if canManageTeamMedia(teamId);');
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST)('team media coach rules engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'demo-allplays',
            firestore: { rules },
            storage: { rules: storageRules }
        });
    });

    beforeEach(async () => {
        await Promise.all([
            testEnv.clearFirestore(),
            testEnv.clearStorage()
        ]);

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await Promise.all([
                setDoc(doc(context.firestore(), 'teams', 'team-1'), {
                    ownerId: 'owner-1',
                    adminEmails: ['coach@example.com']
                }),
                setDoc(doc(context.firestore(), 'users', 'coach-1'), {
                    email: 'coach@example.com',
                    isAdmin: false,
                    coachOf: ['team-1']
                }),
                setDoc(doc(context.firestore(), 'users', 'outsider-1'), {
                    email: 'outsider@example.com',
                    isAdmin: false
                }),
                setDoc(doc(context.firestore(), 'users', 'forged-coach-1'), {
                    email: 'forged@example.com',
                    isAdmin: false,
                    coachOf: ['team-1']
                })
            ]);
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    it('allows a linked coach to create albums, change visibility, and add video links', async () => {
        const coach = testEnv.authenticatedContext('coach-1', { email: 'coach@example.com' });
        const folderRef = doc(coach.firestore(), 'teams', 'team-1', 'mediaFolders', 'folder-1');

        await assertSucceeds(setDoc(folderRef, {
            name: 'Game Film',
            visibility: 'team',
            order: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }));
        await assertSucceeds(updateDoc(folderRef, {
            visibility: 'private',
            updatedAt: serverTimestamp()
        }));
        await assertSucceeds(setDoc(doc(coach.firestore(), 'teams', 'team-1', 'mediaItems', 'video-1'), {
            folderId: 'folder-1',
            title: 'Replay',
            type: 'video-link',
            url: 'https://youtu.be/example',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }));
    });

    it('denies outsiders from self-granting coach membership or managing albums', async () => {
        const outsider = testEnv.authenticatedContext('outsider-1', { email: 'outsider@example.com' });

        await assertFails(updateDoc(doc(outsider.firestore(), 'users', 'outsider-1'), {
            coachOf: ['team-1']
        }));
        await assertFails(setDoc(doc(outsider.firestore(), 'teams', 'team-1', 'mediaFolders', 'forged-folder'), {
            name: 'Forged album',
            visibility: 'private'
        }));
    });

    it('denies historically forged coach links without team admin-email provenance', async () => {
        const forgedCoach = testEnv.authenticatedContext('forged-coach-1', { email: 'forged@example.com' });

        await assertFails(setDoc(doc(forgedCoach.firestore(), 'teams', 'team-1', 'mediaFolders', 'forged-coach-folder'), {
            name: 'Forged coach album',
            visibility: 'private'
        }));
    });

    it('denies media management after coach link revocation', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'users', 'coach-1'), {
                email: 'coach@example.com',
                isAdmin: false,
                coachOf: []
            });
        });

        const coach = testEnv.authenticatedContext('coach-1', { email: 'coach@example.com' });

        await assertFails(setDoc(doc(coach.firestore(), 'teams', 'team-1', 'mediaFolders', 'revoked-folder'), {
            name: 'Revoked album',
            visibility: 'private'
        }));
    });

    it('allows linked coach uploads while denying unlinked uploads', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams', 'team-1', 'mediaFolders', 'folder-1'), {
                name: 'Private Film',
                visibility: 'private'
            });
        });

        const coach = testEnv.authenticatedContext('coach-1', { email: 'coach@example.com' });
        const outsider = testEnv.authenticatedContext('outsider-1', { email: 'outsider@example.com' });

        await assertSucceeds(uploadBytes(
            ref(coach.storage(), 'team-media/team-1/folder-1/coach-1/clip.jpg'),
            new Uint8Array([1, 2, 3]),
            { contentType: 'image/jpeg' }
        ));
        await assertFails(uploadBytes(
            ref(outsider.storage(), 'team-media/team-1/folder-1/outsider-1/clip.jpg'),
            new Uint8Array([1, 2, 3]),
            { contentType: 'image/jpeg' }
        ));
    });
});
