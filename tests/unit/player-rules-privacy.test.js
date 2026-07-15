import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

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
    });

    it('allows linked parents to write household contacts only through the private profile doc', () => {
        expect(rules).not.toContain("affectedKeys().hasOnly(['parents'])");
        expect(rules).toContain("request.resource.data.keys().hasOnly(['emergencyContact', 'medicalInfo', 'parents', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['emergencyContact', 'medicalInfo', 'parents', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.parents.hasAll(resource.data.parents)");
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
            await setDoc(doc(db, 'teams/team-1'), { ownerId: 'owner-1', adminEmails: [], isPublic: true });
            await setDoc(doc(db, 'users/parent-1'), { parentPlayerKeys: ['team-1::player-1'] });
            await setDoc(doc(db, 'teams/team-1/players/player-1'), {
                name: 'Avery Lee',
                profile: { address: { street: '123 Main' } }
            });
            await setDoc(doc(db, 'teams/team-1/players/player-2'), {
                name: 'Sam Lee',
                profile: { birthDate: '2014-02-03' }
            });
            await setDoc(doc(db, 'teams/team-1/players/player-1/private/profile'), {
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
        await assertSucceeds(setDoc(doc(ownerDb, 'teams/team-1/players/public-safe'), {
            name: 'Public Safe',
            number: '4',
            position: 'Forward',
            profile: { preferredName: 'Rocket', position: 'Forward', alternateNumber: '14' }
        }));
    });
});
