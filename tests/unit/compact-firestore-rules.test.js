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
            'function f0(data){return data.isVeryLongHelperName=="isVeryLongHelperName(";}match /teams/{teamId}{allow read:if f0(resource.data);}\n'
        );
    });

    it('keeps the production artifact comfortably below the deploy budget', () => {
        const source = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        const compact = compactFirestoreRules(source);

        expect(Buffer.byteLength(compact, 'utf8')).toBeLessThanOrEqual(132 * 1024);
        expect(compact).toContain('function f');
        expect(compact).toContain('match /chatConversations/{conversationId}');
        expect(compact).not.toContain('function isTeamOwnerOrAdmin(teamId)');
    });
});
