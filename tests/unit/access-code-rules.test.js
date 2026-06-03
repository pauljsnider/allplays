import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const accessCodeMatch = rules.match(/match \/accessCodes\/\{codeId\} \{[\s\S]*?\n\s*\}/);
const accessCodeRules = accessCodeMatch?.[0] || '';

describe('access code Firestore rules', () => {
    it('removes the public accessCodes read loophole and scopes raw access to authorized users', () => {
        expect(accessCodeRules).toContain('match /accessCodes/{codeId}');
        expect(rules).toContain('function canReadAccessCode(data)');
        expect(rules).toContain("data.generatedBy == request.auth.uid");
        expect(rules).toContain("request.auth.token.email.lower() == data.email.lower()");
        expect(rules).toContain('isTeamOwnerOrAdmin(data.teamId)');
        expect(accessCodeRules).toContain('allow get: if resource == null || canReadAccessCode(resource.data);');
        expect(accessCodeRules).toContain('allow list: if canReadAccessCode(resource.data);');
        expect(accessCodeRules).not.toContain('allow read: if true;');
    });

    it('does not allow arbitrary team, creator, or document-id reads without scoped authorization', () => {
        expect(accessCodeRules).not.toMatch(/allow\s+read\s*:\s*if\s+true/);
        expect(accessCodeRules).not.toMatch(/allow\s+list\s*:\s*if\s+true/);
        expect(accessCodeRules).not.toMatch(/allow\s+get\s*:\s*if\s+true/);
        expect(accessCodeRules).toContain('allow list: if canReadAccessCode(resource.data);');
        expect(accessCodeRules).toContain('allow get: if resource == null || canReadAccessCode(resource.data);');
    });
});
