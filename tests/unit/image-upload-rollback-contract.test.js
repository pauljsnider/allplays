import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('legacy image upload rollback contracts', () => {
    it('removes own authenticated profile uploads without deleting team-owned photos during account deletion', () => {
        const source = read('functions/index.js');

        expect(source).toContain('primaryBucket.deleteFiles({ prefix: `profile-photos/users/${uid}/`, force: true })');
        expect(source).toContain('primaryBucket.deleteFiles({ prefix: `profile-photos/team-drafts/${uid}/`, force: true })');
        expect(source).not.toContain('primaryBucket.deleteFiles({ prefix: `profile-photos/teams/${uid}/`');
    });

    it('creates a team before uploading its photo and persists the final team-owned path', () => {
        const source = read('edit-team.html');
        const createIndex = source.indexOf('const newTeamId = await createTeam(teamData);');
        const newTeamUploadIndex = source.indexOf('teamId: newTeamId', createIndex);

        expect(source).toContain('const uploadedPhoto = await uploadTeamPhoto(pendingTeamPhotoFile, {');
        expect(createIndex).toBeGreaterThan(0);
        expect(newTeamUploadIndex).toBeGreaterThan(createIndex);
        expect(source).not.toContain("teamId: currentTeamId || ''");
        expect(source).toContain('photoPath: uploadedPhoto.path');
        expect(source).toContain('teamPhotoPersisted = true;');
        expect(source).toContain('if (newlyUploadedTeamPhotoPath && !teamPhotoPersisted && definitiveNonCommit)');
        expect(source).toContain('await deleteLegacyImageUpload(newlyUploadedTeamPhotoPath).catch(() => undefined);');
        expect(source).toContain('The team save may have completed, so the uploaded photo was preserved.');
    });

    it('saves roster photos and private fields in one batch and rolls back failed uploads', () => {
        const source = read('edit-roster.html');
        const submitIndex = source.indexOf("document.getElementById('add-player-form').addEventListener('submit'");

        expect(source).toContain('const uploadedPhoto = await uploadPlayerPhoto(file, {');
        expect(source).toContain('playerId: reservedPlayerId');
        expect(source.indexOf("let newlyUploadedPlayerPhotoPath = '';", submitIndex)).toBeGreaterThan(submitIndex);
        expect(source).toContain("type: 'add',");
        expect(source).toContain('playerId: reservedPlayerId,');
        expect(source).toContain('payload: playerData,');
        expect(source).not.toContain('const savedPlayerId = await addPlayer(currentTeamId, playerData);');
        expect(source).toContain('if (newlyUploadedPlayerPhotoPath && !playerPhotoPersisted)');
    });

    it('validates player edits before uploading and keeps an already referenced photo on private-save failure', () => {
        const source = read('player.html');
        const validationIndex = source.indexOf('const validationErrors = validateRosterProfileValues');
        const uploadIndex = source.indexOf('uploadPlayerPhoto(photoFile, {', validationIndex);

        expect(validationIndex).toBeGreaterThan(0);
        expect(uploadIndex).toBeGreaterThan(validationIndex);
        expect(source).toContain('playerPhotoPersisted = Boolean(photoUrl);');
        expect(source).toContain('if (newlyUploadedPlayerPhotoPath && !playerPhotoPersisted)');
    });

    it('rolls back direct game statsheet uploads when the game update fails', () => {
        const source = read('game.html');

        expect(source).toContain("uploadStatSheetPhoto(teamId, file, { returnUpload: true })");
        expect(source).toContain('{ path: upload.path, storage: upload.storage }');
        expect(source).toContain('if (newlyUploadedStatSheet && !statSheetPersisted)');
        expect(source).toContain('await deleteUploadedMediaObjects([newlyUploadedStatSheet]).catch(() => undefined);');
    });

    it('waits for replacement confirmation before uploading a tracked statsheet and preserves uncertain commits', () => {
        const source = read('track-statsheet.html');
        const confirmIndex = source.indexOf("confirm('This game already has tracked data. Replace it with the stat sheet results?')");
        const uploadIndex = source.indexOf("uploadStatSheetPhoto(currentTeamId, statSheetFile, { returnUpload: true })");

        expect(uploadIndex).toBeGreaterThan(confirmIndex);
        expect(source).toContain('{ commitStateUnknown: true }');
        expect(source).toContain("error?.commitStateUnknown !== true");
        expect(source).toContain("storage: lateUpload.storage");
        expect(source).toContain('{ path: upload.path, storage: upload.storage }');
        expect(source).toContain('if (newlyUploadedStatSheet && !statSheetPersisted');
        expect(source).toContain('await deleteUploadedMediaObjects([newlyUploadedStatSheet])');
    });

    it('preserves the drill diagram storage target through rollback', () => {
        const source = read('drills.html');

        expect(source).toContain("uploadDrillDiagram(state.teamId, drillId, file, { returnUpload: true })");
        expect(source).toContain('{ path: upload.path, storage: upload.storage }');
        expect(source).toContain('await deleteUploadedMediaObjects(newlyUploadedDiagrams)');
    });
});
