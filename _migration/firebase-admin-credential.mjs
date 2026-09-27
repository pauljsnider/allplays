import { readFileSync } from 'node:fs';
import { Storage as GoogleCloudStorage } from '@google-cloud/storage';
import { applicationDefault, cert } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

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

function createMigrationGoogleAuth(accessToken, projectId, {
    GoogleAuthClass = GoogleAuth,
    OAuth2ClientClass = OAuth2Client
} = {}) {
    const authClient = new OAuth2ClientClass();
    authClient.setCredentials({ access_token: accessToken });
    return new GoogleAuthClass({ authClient, projectId });
}

export function getMigrationFirestore({
    projectId,
    env = process.env,
    FirestoreClass = Firestore,
    GoogleAuthClass = GoogleAuth,
    OAuth2ClientClass = OAuth2Client,
    getFirestoreFn = getFirestore
}) {
    const accessToken = String(env.GOOGLE_OAUTH_ACCESS_TOKEN || '').trim();
    if (!accessToken) return getFirestoreFn();

    // Firebase Admin 12.7 rejects custom Credential implementations before
    // constructing Firestore. Pass the short-lived OIDC token through the
    // officially supported Google Auth hook on the underlying Firestore client.
    const auth = createMigrationGoogleAuth(accessToken, projectId, {
        GoogleAuthClass,
        OAuth2ClientClass
    });
    return new FirestoreClass({ projectId, auth });
}

export function getMigrationStorageBucket({
    projectId,
    bucketName,
    env = process.env,
    StorageClass = GoogleCloudStorage,
    GoogleAuthClass = GoogleAuth,
    OAuth2ClientClass = OAuth2Client,
    getStorageFn = getStorage
}) {
    const accessToken = String(env.GOOGLE_OAUTH_ACCESS_TOKEN || '').trim();
    if (!accessToken) return getStorageFn().bucket(bucketName);

    const authClient = createMigrationGoogleAuth(accessToken, projectId, {
        GoogleAuthClass,
        OAuth2ClientClass
    });
    return new StorageClass({ projectId, authClient }).bucket(bucketName);
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
