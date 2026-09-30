import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import {
    COACHES_ONLY_GAME_NOTE_MAX_LENGTH,
    getCoachesOnlyGameNotePath,
    loadCoachesOnlyGameNote,
    normalizeCoachesOnlyGameNoteText,
    saveCoachesOnlyGameNote
} from '../../js/coaches-only-game-notes.js';

function createFirestoreHarness({ exists = true, data = { text: 'Hold the high line.' } } = {}) {
    const reference = { path: 'private-note-reference' };
    return {
        db: { name: 'test-db' },
        doc: vi.fn(() => reference),
        getDoc: vi.fn(async () => ({
            exists: () => exists,
            data: () => data
        })),
        setDoc: vi.fn(async () => undefined),
        serverTimestamp: vi.fn(() => ({ type: 'server-timestamp' })),
        reference
    };
}

function buildSharedGameRouteId(sharedGamePath) {
    const reversibleId = `shared_${encodeURIComponent(sharedGamePath)}`;
    if (reversibleId.length <= 128) return reversibleId;
    return `sharedh_${createHash('sha256').update(sharedGamePath, 'utf8').digest('base64url')}`;
}

describe('coaches-only game notes', () => {
    it('uses one fixed private-note document beneath the canonical game', async () => {
        await expect(getCoachesOnlyGameNotePath('team.one', 'game:1')).resolves.toEqual([
            'teams',
            'team.one',
            'games',
            'game:1',
            'coachNotes',
            'main'
        ]);
        await expect(getCoachesOnlyGameNotePath('team/one', 'game-1')).rejects.toThrow('Team ID is invalid.');
    });

    it('maps every valid route alias for one shared game beneath the authoritative shared-game document', async () => {
        const shortPath = 'organizations/org-1/sharedGames/game-1';
        const expectedPath = ['organizations', 'org-1', 'sharedGames', 'game-1', 'coachNotes', 'team-1'];
        await expect(getCoachesOnlyGameNotePath('team-1', `shared_${encodeURIComponent(shortPath)}`)).resolves.toEqual(expectedPath);
        await expect(getCoachesOnlyGameNotePath('team-1', `shared::${encodeURIComponent(shortPath)}`)).resolves.toEqual(expectedPath);
        await expect(getCoachesOnlyGameNotePath('team-1', `shared_${shortPath}`, shortPath)).resolves.toEqual(expectedPath);
        await expect(getCoachesOnlyGameNotePath(
            'team-1',
            buildSharedGameRouteId(shortPath),
            shortPath
        )).resolves.toEqual(expectedPath);

        const tournamentPath = `tournaments/${'t'.repeat(70)}/sharedGames/${'g'.repeat(70)}`;
        const tournamentRouteId = buildSharedGameRouteId(tournamentPath);
        expect(tournamentRouteId).toBe('sharedh_bHLrNE27NdLMWkr_C2qkJlk_06GZVFX0A3zVNTbgzY8');
        await expect(getCoachesOnlyGameNotePath('team-1', tournamentRouteId, tournamentPath)).resolves.toEqual([
            'tournaments',
            't'.repeat(70),
            'sharedGames',
            'g'.repeat(70),
            'coachNotes',
            'team-1'
        ]);
        await expect(getCoachesOnlyGameNotePath('team-1', 'sharedh_missing-path')).rejects.toThrow('Shared game path is required.');
        await expect(getCoachesOnlyGameNotePath('team-1', 'sharedh_bad-path', 'users/user-1/sharedGames/game-1'))
            .rejects.toThrow('Shared game path is invalid.');
        await expect(getCoachesOnlyGameNotePath('team-1', 'direct/game')).rejects.toThrow('Game ID is invalid.');
    });

    it('binds an explicit shared path to its exact route identity before any read or write', async () => {
        const firstPath = 'organizations/org-1/sharedGames/game-1';
        const secondPath = 'organizations/org-1/sharedGames/game-2';
        await expect(getCoachesOnlyGameNotePath(
            'team-1',
            buildSharedGameRouteId(firstPath),
            secondPath
        )).rejects.toThrow('Shared game identity does not match its path.');
        await expect(getCoachesOnlyGameNotePath(
            'team-1',
            'ordinary-game',
            firstPath
        )).rejects.toThrow('Shared game identity does not match its path.');

        const longPath = `organizations/${'o'.repeat(70)}/sharedGames/${'g'.repeat(70)}`;
        await expect(getCoachesOnlyGameNotePath(
            'team-1',
            `sharedh_${'a'.repeat(43)}`,
            longPath
        )).rejects.toThrow('Shared game identity does not match its path.');
    });

    it('normalizes line endings without trimming coach formatting', () => {
        expect(normalizeCoachesOnlyGameNoteText('  First\r\nSecond\r')).toBe('  First\nSecond\n');
        expect(() => normalizeCoachesOnlyGameNoteText(null)).toThrow('must be a string');
        expect(() => normalizeCoachesOnlyGameNoteText('x'.repeat(COACHES_ONLY_GAME_NOTE_MAX_LENGTH + 1)))
            .toThrow(`cannot exceed ${COACHES_ONLY_GAME_NOTE_MAX_LENGTH} characters`);
    });

    it('distinguishes an authoritative missing document from a read failure', async () => {
        const missingHarness = createFirestoreHarness({ exists: false });
        await expect(loadCoachesOnlyGameNote({
            ...missingHarness,
            teamId: 'team-1',
            gameId: 'game-1'
        })).resolves.toEqual({
            exists: false,
            text: '',
            updatedAt: null,
            updatedBy: null
        });

        const failedHarness = createFirestoreHarness();
        failedHarness.getDoc.mockRejectedValueOnce(new Error('permission denied'));
        await expect(loadCoachesOnlyGameNote({
            ...failedHarness,
            teamId: 'team-1',
            gameId: 'game-1'
        })).rejects.toThrow('permission denied');
    });

    it('rejects malformed stored note data instead of treating it as empty', async () => {
        const harness = createFirestoreHarness({ data: { text: 42 } });
        await expect(loadCoachesOnlyGameNote({
            ...harness,
            teamId: 'team-1',
            gameId: 'game-1'
        })).rejects.toThrow('Coaches-only note data is invalid.');
    });

    it('writes only note text and server-owned audit attribution', async () => {
        const harness = createFirestoreHarness();
        await expect(saveCoachesOnlyGameNote({
            ...harness,
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'coach.user:1',
            text: 'Press after turnovers.\r\nWatch their left wing.'
        })).resolves.toEqual({
            text: 'Press after turnovers.\nWatch their left wing.',
            updatedBy: 'coach.user:1'
        });

        expect(harness.doc).toHaveBeenCalledWith(
            harness.db,
            'teams',
            'team-1',
            'games',
            'game-1',
            'coachNotes',
            'main'
        );
        expect(harness.setDoc).toHaveBeenCalledWith(harness.reference, {
            text: 'Press after turnovers.\nWatch their left wing.',
            updatedAt: { type: 'server-timestamp' },
            updatedBy: 'coach.user:1'
        });
    });

    it('writes a shared note under its physical game with the team as the private note id', async () => {
        const harness = createFirestoreHarness();
        const sharedGamePath = `tournaments/${'t'.repeat(70)}/sharedGames/${'g'.repeat(70)}`;
        await saveCoachesOnlyGameNote({
            ...harness,
            teamId: 'team-1',
            gameId: buildSharedGameRouteId(sharedGamePath),
            sharedGamePath,
            userId: 'coach-1',
            text: 'Track their late runners.'
        });

        expect(harness.doc).toHaveBeenCalledWith(
            harness.db,
            'tournaments',
            't'.repeat(70),
            'sharedGames',
            'g'.repeat(70),
            'coachNotes',
            'team-1'
        );
    });

    it('does not start a write when identity or note validation fails', async () => {
        const harness = createFirestoreHarness();
        await expect(saveCoachesOnlyGameNote({
            ...harness,
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'bad/user',
            text: 'Private note'
        })).rejects.toThrow('User ID is invalid.');
        await expect(saveCoachesOnlyGameNote({
            ...harness,
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'coach-1',
            text: 'x'.repeat(COACHES_ONLY_GAME_NOTE_MAX_LENGTH + 1)
        })).rejects.toThrow(`cannot exceed ${COACHES_ONLY_GAME_NOTE_MAX_LENGTH} characters`);
        const firstSharedPath = 'organizations/org-1/sharedGames/game-1';
        const mismatchedSharedPath = 'organizations/org-1/sharedGames/game-2';
        await expect(loadCoachesOnlyGameNote({
            ...harness,
            teamId: 'team-1',
            gameId: buildSharedGameRouteId(firstSharedPath),
            sharedGamePath: mismatchedSharedPath
        })).rejects.toThrow('Shared game identity does not match its path.');
        await expect(saveCoachesOnlyGameNote({
            ...harness,
            teamId: 'team-1',
            gameId: buildSharedGameRouteId(firstSharedPath),
            sharedGamePath: mismatchedSharedPath,
            userId: 'coach-1',
            text: 'Private note'
        })).rejects.toThrow('Shared game identity does not match its path.');
        expect(harness.doc).not.toHaveBeenCalled();
        expect(harness.getDoc).not.toHaveBeenCalled();
        expect(harness.setDoc).not.toHaveBeenCalled();
    });
});
