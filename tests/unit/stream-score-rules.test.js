import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('stream and score Firestore rules', () => {
    it('allows scoped volunteers to update stream and score correlation metadata only through game update helpers', () => {
        expect(rules).toContain("'broadcastSession', 'updatedAt',");
        expect(rules).toContain("'scoreUpdatedAt', 'scoreUpdatedBy', 'scoreStreamSessionId'");
        expect(rules).toContain('isScorekeepingGameUpdate(teamId, gameId)');
        expect(rules).toContain('isVideographyGameUpdate(teamId, gameId)');
    });

    it('guards stream and score metadata updates against unsafe ids and spoofed score attribution', () => {
        expect(rules).toContain('function isSafeDocumentId(documentId)');
        expect(rules).toContain("!documentId.matches('.*[/].*')");
        expect(rules).toContain('isSafeDocumentId(teamId) &&');
        expect(rules).toContain('isSafeDocumentId(gameId) &&');
        expect(rules).toContain('function isScoreMetadataAttributionValid()');
        expect(rules).toContain('request.resource.data.scoreUpdatedBy == request.auth.uid');
        expect(rules).toContain('isScoreMetadataAttributionValid() &&');
    });
});
