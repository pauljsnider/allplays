import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const profileSource = readFileSync(new URL('../../apps/app/src/pages/Profile.tsx', import.meta.url), 'utf8');

describe('Profile lazy-load guards', () => {
    it('loads notification teams only from the Alerts section and only once', () => {
        expect(profileSource).toContain("if (!user || activeProfileSection !== 'alerts' || notificationTeamsLoaded) {");
    });

    it('loads invite history only from the Invites section and only once', () => {
        expect(profileSource).toContain("if (!user || activeProfileSection !== 'invites' || accessCodesLoaded) {");
    });

    it('loads parent-linked merge options only when the panel is expanded and only once', () => {
        expect(profileSource).toContain("if (!user || !accountMergeExpanded || parentLinkedTeamsLoaded) {");
    });

    it('resets lazy-loaded section state when the signed-in user changes', () => {
        expect(profileSource).toContain('setNotificationTeamsLoaded(false);');
        expect(profileSource).toContain('setAccessCodesLoaded(false);');
        expect(profileSource).toContain('setParentLinkedTeamsLoaded(false);');
    });
});

describe('Profile photo code lazy-load guards', () => {
    // acquireProfilePhoto, normalizeProfilePhoto, and uploadProfilePhoto must NOT be
    // statically imported. They live in profilePhotoService.ts (which eagerly imports
    // @capacitor/camera and @capacitor/core) and must only be loaded via dynamic import()
    // when the user triggers a photo action.

    it('does not statically import acquireProfilePhoto from profileService', () => {
        const pattern = /^import\s+\{[^}]*acquireProfilePhoto[^}]*\}\s+from\s+['"][^'"]*profileService['"]/m;
        expect(profileSource).not.toMatch(pattern);
    });

    it('does not statically import normalizeProfilePhoto from profileService', () => {
        const pattern = /^import\s+\{[^}]*normalizeProfilePhoto[^}]*\}\s+from\s+['"][^'"]*profileService['"]/m;
        expect(profileSource).not.toMatch(pattern);
    });

    it('does not statically import uploadProfilePhoto from profileService', () => {
        const pattern = /^import\s+\{[^}]*uploadProfilePhoto[^}]*\}\s+from\s+['"][^'"]*profileService['"]/m;
        expect(profileSource).not.toMatch(pattern);
    });

    it('does not statically import acquireProfilePhoto from profilePhotoService', () => {
        const pattern = /^import\s+\{[^}]*acquireProfilePhoto[^}]*\}\s+from\s+['"][^'"]*profilePhotoService['"]/m;
        expect(profileSource).not.toMatch(pattern);
    });

    it('does not statically import normalizeProfilePhoto from profilePhotoService', () => {
        const pattern = /^import\s+\{[^}]*normalizeProfilePhoto[^}]*\}\s+from\s+['"][^'"]*profilePhotoService['"]/m;
        expect(profileSource).not.toMatch(pattern);
    });

    it('does not statically import uploadProfilePhoto from profilePhotoService', () => {
        const pattern = /^import\s+\{[^}]*uploadProfilePhoto[^}]*\}\s+from\s+['"][^'"]*profilePhotoService['"]/m;
        expect(profileSource).not.toMatch(pattern);
    });

    it('uses a dynamic import of profilePhotoService', () => {
        expect(profileSource).toMatch(/import\s*\(\s*['"][^'"]*profilePhotoService['"]\s*\)/);
    });
});
