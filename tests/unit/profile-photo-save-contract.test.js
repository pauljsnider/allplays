import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../profile.html', import.meta.url), 'utf8');

describe('legacy profile photo save contract', () => {
    it('does not rewrite the auth email while saving editable profile fields', () => {
        const handlerStart = source.indexOf("document.getElementById('save-profile').addEventListener");
        const handlerEnd = source.indexOf('renderNotificationPreferenceGroups();', handlerStart);
        const handler = source.slice(handlerStart, handlerEnd);

        expect(handler).toContain('await updateUserProfile(currentUser.uid, {');
        expect(handler).not.toContain('email: currentUser.email');
    });

    it('persists cleanup paths and reconciles ambiguous profile saves before deleting either object', () => {
        expect(source).toContain("uploadUserPhoto(fileInput.files[0], currentUser.uid, { returnUpload: true })");
        expect(source).toContain('currentPhotoPath = uploadedPhoto.path;');
        expect(source).toMatch(/currentPhotoUrl = null;\s*currentPhotoPath = '';/);
        expect(source).toContain('photoPath: currentPhotoPath || null');
        expect(source).toContain('const authoritativeProfile = await getUserProfile(currentUser.uid).catch(() => null);');
        expect(source).toContain('await deleteLegacyImageUpload(newlyUploadedPhotoPath).catch(() => undefined);');
        expect(source).toContain('await deleteLegacyImageUpload(previousPhotoPath).catch(() => undefined);');
        expect(source).toContain('Save status unknown. The uploaded photo was preserved; refresh before retrying.');
        expect(source).toContain('photoChanged = false;');
        expect(source).toContain("fileInput.value = '';");
    });
});
