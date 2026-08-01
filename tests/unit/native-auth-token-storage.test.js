import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authSource = readFileSync(
    new URL('../../apps/app/src/lib/authService.ts', import.meta.url),
    'utf8'
);
const nativeStorageSource = readFileSync(
    new URL('../../apps/app/src/lib/nativeStorageUpload.ts', import.meta.url),
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

    it('uses the signed-in native credential for primary-project profile uploads without persisting tokens', () => {
        expect(nativeStorageSource).toContain('getNativeAuthIdToken(true)');
        expect(nativeStorageSource).toContain('getNativeAuthUserId()');
        expect(nativeStorageSource).toContain('getPrimaryAppCheckHeaders');
        expect(nativeStorageSource).toContain('profile-photos/users/${userId}');
        expect(nativeStorageSource).toContain('profile-photos/teams/${safeTeamId}/players/${safePlayerId}/${userId}');
        expect(nativeStorageSource).not.toContain('window.localStorage');
        expect(nativeStorageSource).not.toContain('refresh_token');
        expect(nativeStorageSource).not.toContain('accounts:signUp');
    });
});
