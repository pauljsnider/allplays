import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('legacy image upload rollback contracts', () => {
    it('rolls back team photos until the team document references them', () => {
        const source = read('edit-team.html');

        expect(source).toContain("uploadTeamPhoto(fileInput.files[0], { returnUpload: true })");
        expect(source).toContain('teamPhotoPersisted = true;');
        expect(source).toContain('if (newlyUploadedTeamPhotoPath && !teamPhotoPersisted)');
        expect(source).toContain('await deleteLegacyImageUpload(newlyUploadedTeamPhotoPath).catch(() => undefined);');
    });

    it('saves roster photos and private fields in one batch and rolls back failed uploads', () => {
        const source = read('edit-roster.html');
        const submitIndex = source.indexOf("document.getElementById('add-player-form').addEventListener('submit'");

        expect(source).toContain("uploadPlayerPhoto(file, { returnUpload: true })");
        expect(source.indexOf("let newlyUploadedPlayerPhotoPath = '';", submitIndex)).toBeGreaterThan(submitIndex);
        expect(source).toContain("type: 'add',\n                        payload: playerData,");
        expect(source).not.toContain('const savedPlayerId = await addPlayer(currentTeamId, playerData);');
        expect(source).toContain('if (newlyUploadedPlayerPhotoPath && !playerPhotoPersisted)');
    });

    it('validates player edits before uploading and keeps an already referenced photo on private-save failure', () => {
        const source = read('player.html');
        const validationIndex = source.indexOf('const validationErrors = validateRosterProfileValues');
        const uploadIndex = source.indexOf("uploadPlayerPhoto(photoFile, { returnUpload: true })", validationIndex);

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
        expect(source).toContain('deleteUploadedMediaObjects([newlyUploadedStatSheet])');
    });
});
