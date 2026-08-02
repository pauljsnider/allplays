import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const teamPlayersMatch = rules.match(/match \/teams\/\{teamId\} \{[\s\S]*?match \/players\/\{playerId\} \{[\s\S]*?match \/private\/profile \{/);
const teamPlayerRules = teamPlayersMatch?.[0] || '';
const collectionGroupPlayersMatch = rules.match(/match \/\{path=\*\*\}\/players\/\{playerId\} \{[\s\S]*?\}/);
const collectionGroupPlayerRules = collectionGroupPlayersMatch?.[0] || '';

describe('player Firestore privacy rules', () => {
    it('classifies parent and household contact fields as restricted player data', () => {
        expect(rules).toContain("'contacts'");
        expect(rules).toContain("'contactEmail'");
        expect(rules).toContain("'contactPhone'");
        expect(rules).toContain("'parents'");
        expect(rules).toContain("'guardianEmail'");
        expect(rules).toContain("'householdContacts'");
    });

    it('blocks collection-group reads of player docs to prevent cross-team leakage', () => {
        expect(collectionGroupPlayerRules).toContain('match /{path=**}/players/{playerId}');
        expect(collectionGroupPlayerRules).toContain('allow read: if false;');
    });

    it('limits direct player reads to public teams unless the viewer is a coach, admin, or linked parent', () => {
        expect(teamPlayerRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) ||');
        expect(teamPlayerRules).toContain('isParentForPlayer(teamId, playerId) ||');
        expect(teamPlayerRules).toContain('get(/databases/$(database)/documents/teams/$(teamId)).data.isPublic == true');
        expect(teamPlayerRules).toContain('!hasRestrictedRosterFieldValues(resource.data)');
    });

    it('checks nested profile custom roster maps before allowing public player doc reads', () => {
        expect(rules).toContain("'birthDate', 'gender', 'grade', 'school', 'jerseySize', 'memberId', 'dominantHandFoot', 'address'");
        expect(rules).toContain("profile.keys().hasAny(restrictedKeys)");
        expect(rules).toContain("hasRestrictedRosterNestedMap(data, 'profile', 'rosterFields', restrictedKeys)");
        expect(rules).toContain("hasRestrictedRosterNestedMap(data, 'profile', 'customFields', restrictedKeys)");
        expect(rules).toContain("hasRestrictedRosterNestedMap(data, 'profile', 'profileFields', restrictedKeys)");
        expect(rules).toContain("hasRestrictedRosterNestedMap(data, 'profile', 'extraFields', restrictedKeys)");
    });

    it('permits public-only updates to legacy players without permitting protected field mutations', () => {
        expect(teamPlayerRules).toContain('keepsRestrictedRosterFieldsImmutable()');
        expect(rules).toContain('request.resource.data.diff(resource.data).affectedKeys().hasAny(restrictedContainers)');
    });

    it('keeps linked-parent private-profile writes limited to medical data and cleanup paths', () => {
        expect(rules).toContain("request.resource.data.keys().hasOnly(['emergencyContact', 'medicalInfo', 'photoPath', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['emergencyContact', 'medicalInfo', 'photoPath', 'updatedAt'])");
        expect(rules).not.toContain("request.resource.data.keys().hasOnly(['emergencyContact', 'medicalInfo', 'parents', 'updatedAt'])");
        expect(rules).not.toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['emergencyContact', 'medicalInfo', 'parents', 'updatedAt'])");
        expect(rules).not.toContain('request.resource.data.parents.hasAll(resource.data.parents)');
    });

    it('keeps cleanup paths private and scoped to the linked player', () => {
        expect(teamPlayerRules).toContain("hasOnly(['photoUrl', 'updatedAt'])");
        expect(rules).toContain("hasOnly(['emergencyContact', 'medicalInfo', 'photoPath', 'updatedAt'])");
        expect(rules).toContain("'^profile-photos/teams/' + teamId + '/players/' + playerId + '/[^/]+$'");
        expect(rules).toContain("'photoPath'");
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('player privacy rules engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-player-privacy-${Date.now()}`,
            firestore: { rules }
        });
    }, 30000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'teams/team-1'), {
                ownerId: 'owner-1',
                adminEmails: ['manager@example.com'],
                isPublic: true
            });
            await setDoc(doc(db, 'users/parent-1'), {
                parentPlayerKeys: [
                    'team-1::player-1',
                    'team-1::player-create-medical',
                    'team-1::player-create-parents'
                ]
            });
            await setDoc(doc(db, 'teams/team-1/players/player-1'), {
                name: 'Avery Lee',
                profile: { address: { street: '123 Main' } }
            });
            await setDoc(doc(db, 'teams/team-1/players/player-2'), {
                name: 'Sam Lee',
                profile: { birthDate: '2014-02-03' }
            });
            await setDoc(doc(db, 'teams/team-1/players/player-3'), {
                name: 'Jordan Lee',
                profile: { profileFields: { birthDate: '2014-02-03' } }
            });
            await setDoc(doc(db, 'teams/team-1/players/player-4'), {
                name: 'Riley Lee',
                profile: { extraFields: { address: { street: '123 Main' } } }
            });
            await setDoc(doc(db, 'teams/team-1/players/player-1/private/profile'), {
                parents: [{ userId: 'trusted-parent', email: 'trusted@example.com' }],
                rosterFields: { birthDate: '2014-02-03', address: { street: '123 Main' } }
            });
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    it('denies anonymous legacy protected fields while allowing authorized private-profile reads', async () => {
        const anonymousDb = testEnv.unauthenticatedContext().firestore();
        const ownerDb = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com' }).firestore();
        const parentDb = testEnv.authenticatedContext('parent-1', { email: 'parent@example.com' }).firestore();

        await assertFails(getDoc(doc(anonymousDb, 'teams/team-1/players/player-1')));
        await assertFails(getDoc(doc(anonymousDb, 'teams/team-1/players/player-2')));
        await assertFails(getDoc(doc(anonymousDb, 'teams/team-1/players/player-3')));
        await assertFails(getDoc(doc(anonymousDb, 'teams/team-1/players/player-4')));
        await assertSucceeds(getDoc(doc(ownerDb, 'teams/team-1/players/player-1/private/profile')));
        await assertSucceeds(getDoc(doc(parentDb, 'teams/team-1/players/player-1/private/profile')));
    });

    it('rejects protected public writes while allowing public-safe roster fields', async () => {
        const ownerDb = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com' }).firestore();

        await assertFails(setDoc(doc(ownerDb, 'teams/team-1/players/rejected-address'), {
            name: 'Private Address',
            profile: { address: { city: 'Kansas City' } }
        }));
        await assertFails(updateDoc(doc(ownerDb, 'teams/team-1/players/player-1'), {
            profile: { birthDate: '2014-02-03' }
        }));
        await assertFails(setDoc(doc(ownerDb, 'teams/team-1/players/rejected-profile-fields'), {
            name: 'Private Birth Date',
            profile: { profileFields: { birthDate: '2014-02-03' } }
        }));
        await assertFails(setDoc(doc(ownerDb, 'teams/team-1/players/rejected-extra-fields'), {
            name: 'Private Address',
            profile: { extraFields: { address: { city: 'Kansas City' } } }
        }));
        await assertSucceeds(setDoc(doc(ownerDb, 'teams/team-1/players/public-safe'), {
            name: 'Public Safe',
            number: '4',
            position: 'Forward',
            profile: { preferredName: 'Rocket', position: 'Forward', alternateNumber: '14' }
        }));
        await assertFails(setDoc(doc(ownerDb, 'teams/team-1/players/public-path-leak'), {
            name: 'Public Path Leak',
            photoPath: 'profile-photos/teams/team-1/players/public-path-leak/private.jpg'
        }));
    });

    it('allows status and public-field updates on legacy docs while keeping protected containers immutable', async () => {
        const ownerDb = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com' }).firestore();

        await assertSucceeds(updateDoc(doc(ownerDb, 'teams/team-1/players/player-1'), {
            active: false,
            deactivatedAt: 'now'
        }));
        await assertSucceeds(updateDoc(doc(ownerDb, 'teams/team-1/players/player-1'), {
            active: true,
            deactivatedAt: null,
            number: '8'
        }));
        await assertFails(updateDoc(doc(ownerDb, 'teams/team-1/players/player-1'), {
            profile: { address: { street: '456 Other' } }
        }));
    });

    it('allows linked-parent medical writes but denies every client mutation of parents', async () => {
        const parentDb = testEnv.authenticatedContext('parent-1', { email: 'parent@example.com' }).firestore();
        const existingProfileRef = doc(parentDb, 'teams/team-1/players/player-1/private/profile');

        await assertSucceeds(updateDoc(existingProfileRef, { medicalInfo: 'Asthma inhaler' }));
        await assertSucceeds(setDoc(
            doc(parentDb, 'teams/team-1/players/player-create-medical/private/profile'),
            { emergencyContact: { name: 'Pat Parent', phone: '555-0100' }, medicalInfo: 'Allergy' }
        ));
        await assertFails(setDoc(
            doc(parentDb, 'teams/team-1/players/player-create-parents/private/profile'),
            { parents: [{ userId: 'attacker', email: 'attacker@example.com' }] }
        ));
        await assertFails(updateDoc(existingProfileRef, {
            parents: [
                { userId: 'trusted-parent', email: 'trusted@example.com' },
                { userId: 'attacker', email: 'attacker@example.com' }
            ]
        }));
        await assertFails(updateDoc(existingProfileRef, {
            parents: [{ userId: 'replacement', email: 'replacement@example.com' }]
        }));
        await assertFails(updateDoc(existingProfileRef, { parents: [] }));
    });

    it('atomically keeps linked-parent player-photo cleanup paths in the private profile', async () => {
        const parentDb = testEnv.authenticatedContext('parent-1', { email: 'parent@example.com' }).firestore();
        const playerRef = doc(parentDb, 'teams/team-1/players/player-1');
        const privateRef = doc(parentDb, 'teams/team-1/players/player-1/private/profile');
        const ownedPath = 'profile-photos/teams/team-1/players/player-1/new.jpg';

        const saveBatch = writeBatch(parentDb);
        saveBatch.update(playerRef, {
            photoUrl: 'https://firebasestorage.googleapis.com/v0/b/game-flow-c6311.firebasestorage.app/o/owned'
        });
        saveBatch.set(privateRef, { photoPath: ownedPath }, { merge: true });
        await assertSucceeds(saveBatch.commit());
        await assertSucceeds(getDoc(playerRef));
        await assertSucceeds(getDoc(privateRef));
        await assertFails(updateDoc(playerRef, { photoPath: ownedPath }));
        await assertFails(updateDoc(privateRef, {
            photoPath: 'profile-photos/teams/team-1/players/player-2/other.jpg'
        }));
        await assertFails(updateDoc(privateRef, {
            photoPath: 'profile-photos/teams/team-1/players/player-1/nested/other.jpg'
        }));
        const removeBatch = writeBatch(parentDb);
        removeBatch.update(playerRef, { photoUrl: null });
        removeBatch.set(privateRef, { photoPath: null }, { merge: true });
        await assertSucceeds(removeBatch.commit());
    });

    it('retains authorized team-manager contact-list management', async () => {
        const managerDb = testEnv.authenticatedContext('manager-1', { email: 'manager@example.com' }).firestore();

        await assertSucceeds(updateDoc(
            doc(managerDb, 'teams/team-1/players/player-1/private/profile'),
            { parents: [{ userId: 'manager-approved', email: 'approved@example.com' }] }
        ));
    });
});
