import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';

describe('compact Firestore rules', () => {
    it('removes formatting without changing rule expressions or string contents', () => {
        const source = `
            // full-line comment
            match /teams/{teamId} {
                allow read: if value == "https://example.com/a//b"; // inline comment

                allow write: if true;
            }
        `;

        expect(compactFirestoreRules(source)).toBe(
            'match /teams/{teamId}{allow read:if value=="https://example.com/a//b";allow write:if true;}\n'
        );
    });

    it('shortens custom function declarations and calls without changing strings or field names', () => {
        const source = `
            function isVeryLongHelperName(data) {
                return data.isVeryLongHelperName == "isVeryLongHelperName(";
            }
            match /teams/{teamId} {
                allow read: if isVeryLongHelperName(resource.data);
            }
        `;

        expect(compactFirestoreRules(source)).toBe(
            'function a(data){return data.isVeryLongHelperName=="isVeryLongHelperName(";}match /teams/{teamId}{allow read:if a(resource.data);}\n'
        );
    });

    it('never assigns a shortened function name that collides with another identifier', () => {
        const source = `
            function isVeryLongHelperName(data) {
                return data.a == true;
            }
            match /teams/{teamId} {
                allow read: if isVeryLongHelperName(resource.data);
            }
        `;

        const compact = compactFirestoreRules(source);

        expect(compact).toContain('function b(data)');
        expect(compact).toContain('data.a==true');
        expect(compact).toContain('if b(resource.data)');
    });

    it('keeps the production artifact comfortably below the deploy budget', () => {
        const source = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        const compact = compactFirestoreRules(source);

        expect(Buffer.byteLength(compact, 'utf8')).toBeLessThanOrEqual(132 * 1024);
        expect(compact).toMatch(/function [A-Za-z_][A-Za-z0-9_$]*\(/);
        expect(compact).toContain('match /chatConversations/{conversationId}');
        expect(compact).not.toContain('function isTeamOwnerOrAdmin(teamId)');
    });
});
