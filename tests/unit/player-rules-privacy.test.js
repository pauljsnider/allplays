import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const teamPlayersMatch = rules.match(/match \/teams\/\{teamId\} \{[\s\S]*?match \/players\/\{playerId\} \{[\s\S]*?match \/private\/profile \{/);
const teamPlayerRules = teamPlayersMatch?.[0] || '';
const collectionGroupPlayersMatch = rules.match(/match \/\{path=\*\*\}\/players\/\{playerId\} \{[\s\S]*?\}/);
const collectionGroupPlayerRules = collectionGroupPlayersMatch?.[0] || '';

describe('player Firestore privacy rules', () => {
    it('classifies parent and household contact fields as restricted player data', () => {
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

    it('allows linked parents to write household contacts only through the private profile doc', () => {
        expect(rules).not.toContain("affectedKeys().hasOnly(['parents'])");
        expect(rules).toContain("request.resource.data.keys().hasOnly(['emergencyContact', 'medicalInfo', 'parents', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['emergencyContact', 'medicalInfo', 'parents', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.parents.hasAll(resource.data.parents)");
    });
});
