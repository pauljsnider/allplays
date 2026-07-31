import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authSource = readFileSync(
    new URL('../../apps/app/src/lib/authService.ts', import.meta.url),
    'utf8'
);
const photoSource = readFileSync(
    new URL('../../apps/app/src/lib/profilePhotoService.ts', import.meta.url),
    'utf8'
);
const capacitorConfig = JSON.parse(readFileSync(
    new URL('../../capacitor.config.json', import.meta.url),
    'utf8'
));

describe('native credential persistence boundary', () => {
    it('delegates durable credentials to native Firebase Authentication', () => {
        expect(capacitorConfig.plugins.FirebaseAuthentication.skipNativeAuth).toBe(false);
        expect(authSource).toContain('FirebaseAuthentication.signInWithEmailAndPassword({');
        expect(authSource).toContain('FirebaseAuthentication.createUserWithEmailAndPassword({');
        expect(authSource).toContain('FirebaseAuthentication.signInWithApple({ skipNativeAuth: false }');
        expect(authSource).toContain('skipNativeAuth: false');
        expect(authSource).not.toContain("accounts:signInWithPassword");
        expect(authSource).not.toContain("accounts:signInWithIdp");
        expect(authSource).not.toContain('persistNativeRestAuthSession');
    });

    it('persists only sanitized native user metadata and scrubs legacy WebView auth state', () => {
        expect(authSource).toContain('JSON.stringify(sanitizeNativeAuthSession(session))');
        expect(authSource).toContain('volatileNativeRestSession = parsed');
        expect(authSource).toContain('void clearFirebaseAuthStorageSession()');
        expect(authSource).not.toMatch(
            /localStorage\?\.\s*\.?setItem\([^)]*JSON\.stringify\([^)]*(?:idToken|refreshToken)/s
        );
    });

    it('uses an ephemeral image-project token for profile uploads without a persisted session', () => {
        expect(photoSource).toContain('createEphemeralImageUploadIdToken');
        expect(photoSource).not.toContain('allplays-image-upload-session');
        expect(photoSource).not.toContain('refresh_token');
        expect(photoSource).toContain('accounts:signUp');
        expect(photoSource).toContain('deleteEphemeralImageUploadUser');
        expect(photoSource).toContain('accounts:delete');
        expect(photoSource).not.toContain('window.localStorage');
    });
});
