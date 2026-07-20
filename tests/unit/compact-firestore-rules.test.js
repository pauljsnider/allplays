import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';

describe('compact Firestore rules', () => {
    it('removes formatting without changing rule expressions or string contents', () => {
        const source = `
            // full-line comment
            match /teams/{teamId} {
                allow read: if value == "https://example.com/a//b"; // inline text stays intact

                allow write: if true;
            }
        `;

        expect(compactFirestoreRules(source)).toBe([
            'match /teams/{teamId} {',
            'allow read: if value == "https://example.com/a//b"; // inline text stays intact',
            'allow write: if true;',
            '}',
            ''
        ].join('\n'));
    });

    it('keeps the production artifact comfortably below the deploy budget', () => {
        const source = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        const compact = compactFirestoreRules(source);

        expect(Buffer.byteLength(compact, 'utf8')).toBeLessThanOrEqual(180 * 1024);
        expect(compact).toContain('function isTeamOwnerOrAdmin(teamId)');
        expect(compact).toContain('match /chatConversations/{conversationId}');
    });
});
