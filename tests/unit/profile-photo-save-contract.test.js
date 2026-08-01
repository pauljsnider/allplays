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

    it('retains the completed upload for a metadata-save retry instead of uploading it twice', () => {
        expect(source).toContain("uploadUserPhoto(fileInput.files[0], currentUser.uid, { returnUpload: true })");
        expect(source).toContain('photoChanged = false;');
        expect(source).toContain("fileInput.value = '';");
    });
});
