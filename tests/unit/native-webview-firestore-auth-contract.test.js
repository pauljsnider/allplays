import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('native WebView Firestore authentication boundary', () => {
    it('keeps the bridged Firebase Auth session in memory and on the shared default app', () => {
        const runtime = source('apps/app/src/lib/firebaseAuthRuntime.ts');
        const legacyFirebase = source('js/firebase.js');

        expect(runtime).toContain('persistence: inMemoryPersistence');
        expect(runtime).not.toContain('persistence: indexedDBLocalPersistence');
        expect(runtime).toContain("candidate?.name === '[DEFAULT]'");
        expect(legacyFirebase).toContain("candidate.name === '[DEFAULT]'");
    });

    it('bridges the verified native principal before exposing it to app data loaders', () => {
        const authService = source('apps/app/src/lib/authService.ts');

        expect(authService).toContain("'createNativeWebAuthToken'");
        expect(authService).toContain('ensureNativeWebViewAuthSession(fallbackUser.uid)');
        expect(authService).toContain('bridgedUidEmittedBeforeObserver = bootstrapUser.uid');
        expect(authService).toContain('if (bridgedUidEmittedBeforeObserver === user.uid)');
        expect(authService).toContain('getNativeAuthFallbackUser()?.uid || auth.currentUser?.uid');
    });

    it('exports the caller-bound token broker and routes native listener errors to authenticated polling', () => {
        const functionsIndex = source('functions/index.js');
        const chatService = source('apps/app/src/lib/chatService.ts');

        expect(functionsIndex).toContain(
            'exports.createNativeWebAuthToken = functions.https.onCall(createNativeWebAuthToken);'
        );
        expect(chatService).toMatch(/const handleListenerError = \(error: Error\)[\s\S]*if \(isNativeRuntime\(\)\)[\s\S]*void startPollingFallback\(\)/);
        expect(chatService).toContain('subscribeToChatMessages(teamId, { limit: 50, conversationId }');
    });
});
