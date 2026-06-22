import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const playerDetailSource = readFileSync(new URL('../../apps/app/src/pages/PlayerDetail.tsx', import.meta.url), 'utf8');
const playerServiceSource = readFileSync(new URL('../../apps/app/src/lib/playerService.ts', import.meta.url), 'utf8');
const playerServiceTestSource = readFileSync(new URL('./app-player-service.test.js', import.meta.url), 'utf8');
const wiringTestSource = readFileSync(new URL('./athlete-profile-wiring.test.js', import.meta.url), 'utf8');
const storageRulesTestSource = readFileSync(new URL('./athlete-profile-storage-rules.test.js', import.meta.url), 'utf8');

describe('issue 1998 athlete profile upload source contract', () => {
    it('keeps the native athlete profile editor exposing headshot and highlight uploads', () => {
        expect(playerDetailSource).toContain('function AthleteProfileBuilderCard');
        expect(playerDetailSource).toContain('const [headshotFile, setHeadshotFile] = useState<File | null>(null);');
        expect(playerDetailSource).toContain('const [highlightClipFile, setHighlightClipFile] = useState<File | null>(null);');
        expect(playerDetailSource).toContain('accept="image/*"');
        expect(playerDetailSource).toContain('accept="video/*,image/*"');
        expect(playerDetailSource).toContain('Choose a highlight clip under 100 MB.');
        expect(playerDetailSource).toContain('profilePhotoFile: headshotFile');
        expect(playerDetailSource).toContain('highlightClipFile');
    });

    it('keeps service uploads validated, saved, and cleaned up on failure', () => {
        expect(playerServiceSource).toContain('export async function saveParentAthleteProfileDraft');
        expect(playerServiceSource).toContain('if (profilePhotoFile) validateImageFile(profilePhotoFile);');
        expect(playerServiceSource).toContain('if (highlightClipFile) validateHighlightClipFile(highlightClipFile);');
        expect(playerServiceSource).toContain("uploadAthleteProfileMedia(user!.uid, workingProfileId, profilePhotoFile, { kind: 'profile-photo' })");
        expect(playerServiceSource).toContain("uploadAthleteProfileMedia(user!.uid, workingProfileId, highlightClipFile, { kind: 'clip' })");
        expect(playerServiceSource).toContain("source: 'upload'");
        expect(playerServiceSource).toContain('await deleteAthleteProfileMediaByPath(uploadedProfilePhoto.storagePath).catch(() => undefined);');
        expect(playerServiceSource).toContain('await deleteAthleteProfileMediaByPath(uploadedHighlightClip.storagePath).catch(() => undefined);');
    });

    it('keeps upload regression, legacy wiring, and storage-rule coverage in place', () => {
        expect(playerServiceTestSource).toContain('uploads athlete profile headshots before saving and supports linked-photo reset');
        expect(playerServiceTestSource).toContain('uploads a manual athlete profile highlight clip and preserves existing clips');
        expect(playerServiceTestSource).toContain('cleans up uploaded athlete profile highlight clips when saving the profile fails');
        expect(wiringTestSource).toContain('uploadAthleteProfileMedia');
        expect(wiringTestSource).toContain('deleteAthleteProfileMediaByPath');
        expect(storageRulesTestSource).toContain('isAllowedAthleteProfileMediaUploadType(request.resource.contentType);');
    });
});
