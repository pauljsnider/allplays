import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('durable upload object identities', () => {
    it('includes a cryptographically secure attempt token in every direct browser upload path', () => {
        const dbSource = readRepoFile('js/db.js');
        const fallbackMediaSource = readRepoFile('js/fallback-media-paths.js');
        const emailSource = readRepoFile('js/team-email-attachments.js');
        const certificateSource = readRepoFile('js/certificates/assets.js');

        expect(dbSource).toContain('team-videos/${ts}_${nonce}_game-clip_');
        expect(dbSource).toContain('buildGameScopedStatSheetFallbackPath(teamId, gameId, userId, file.name, ts, nonce)');
        expect(fallbackMediaSource).toContain('/${ts}_${requireSecureUploadToken(nonce)}_${safeName}');
        expect(dbSource).toContain('/${Date.now()}-${createSecureUploadToken()}-${sanitizeTeamMediaFileName(file.name)}');
        expect(dbSource).toContain('/${Date.now()}_${createSecureUploadToken()}_${kind}_${safeName}');
        expect(emailSource).toContain('/${ts}_${createSecureUploadToken()}_${safeFileName(file.name)}');
        expect(certificateSource).toContain('return createSecureUploadToken();');
    });

    it('includes the same secure token contract in native chat and profile upload paths', () => {
        const chatSource = readRepoFile('apps/app/src/lib/chatService.ts');
        const nativeStorageSource = readRepoFile('apps/app/src/lib/nativeStorageUpload.ts');
        const playerSource = readRepoFile('apps/app/src/lib/playerService.ts');

        expect(chatSource).toContain('/${Date.now()}_${createSecureUploadToken()}_${safeName}');
        expect(nativeStorageSource).toContain('getRandomValues(bytes)');
        expect(playerSource).toContain('return `${prefix}_${createSecureUploadToken()}`;');
        expect(playerSource).not.toMatch(/createLocalId[\s\S]{0,300}Math\.random/);
    });

    it('does not allow a Math.random fallback in upload identity helpers', () => {
        const helperSources = [
            readRepoFile('js/secure-upload-token.js'),
            readRepoFile('js/profile-photo-paths.js'),
            readRepoFile('js/certificates/assets.js'),
            readRepoFile('apps/app/src/lib/secureUploadToken.ts'),
            readRepoFile('apps/app/src/lib/nativeStorageUpload.ts')
        ].join('\n');

        expect(helperSources).not.toContain('Math.random');
    });
});
