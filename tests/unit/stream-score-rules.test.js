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
});
