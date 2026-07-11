import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('stream and score Firestore rules', () => {
    it('allows scoped volunteers to update stream and score correlation metadata only through game update helpers', () => {
        expect(rules).toContain("'scoreUpdatedAt', 'scoreUpdatedBy', 'scoreStreamSessionId'");
        expect(rules).toContain('isScorekeepingGameUpdate(teamId, gameId)');
        expect(rules).toContain('isStreamingGameUpdate(teamId, gameId)');
        expect(rules).toContain('isVideographyGameUpdate(teamId, gameId)');
        const videographyUpdate = rules.match(/function isVideographyGameUpdate[\s\S]*?\n    \}/)?.[0] || '';
        expect(videographyUpdate).not.toContain("'broadcastSession'");
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

    it('limits streaming helpers to broadcast-session metadata for eligible games', () => {
        expect(rules).toContain('function canStreamGame(teamId, gameId)');
        expect(rules).toContain("request.auth.uid in permission.get('memberIds', [])");
        expect(rules).toContain("mode == 'all_confirmed' && hasConfirmedGameRsvp(teamId, gameId)");
        expect(rules).toContain("'broadcastSession', 'updatedAt'");
        expect(rules).toContain('canReadPublicGameDocument(teamData, gameData)');
        expect(rules).toContain('function isValidStreamingBroadcastSession(data)');
        expect(rules).toContain('data.updatedBy == request.auth.uid');
        expect(rules).toContain('preservesProtectedBroadcastSessionFields(nextSession, existingSession)');
        expect(rules).toContain("['cancelled', 'canceled', 'completed', 'final', 'deleted']");
        expect(rules).toContain("data.localStreamLeaseExpiresAt <= request.time + duration.value(1, 'm')");
    });
});
