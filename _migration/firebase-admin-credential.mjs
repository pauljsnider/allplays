import { readFileSync } from 'node:fs';
import { applicationDefault, cert } from 'firebase-admin/app';

const ACCESS_TOKEN_CACHE_SECONDS = 300;

export function createAccessTokenCredential(accessToken) {
    const normalizedAccessToken = String(accessToken || '').trim();
    if (!normalizedAccessToken) {
        throw new Error('GOOGLE_OAUTH_ACCESS_TOKEN must be non-empty.');
    }
    return {
        async getAccessToken() {
            return {
                access_token: normalizedAccessToken,
                expires_in: ACCESS_TOKEN_CACHE_SECONDS
            };
        }
    };
}

export function getMigrationAdminAppOptions({
    projectId,
    storageBucket,
    env = process.env,
    serviceAccountUrl = new URL('./serviceAccountKey.json', import.meta.url)
}) {
    const options = {
        projectId,
        ...(storageBucket ? { storageBucket } : {})
    };
    if (env.GOOGLE_OAUTH_ACCESS_TOKEN) {
        return {
            ...options,
            credential: createAccessTokenCredential(env.GOOGLE_OAUTH_ACCESS_TOKEN)
        };
    }
    if (env.GOOGLE_APPLICATION_CREDENTIALS) {
        return {
            ...options,
            credential: applicationDefault()
        };
    }
    const serviceAccount = JSON.parse(readFileSync(serviceAccountUrl, 'utf8'));
    return {
        ...options,
        credential: cert(serviceAccount)
    };
}
