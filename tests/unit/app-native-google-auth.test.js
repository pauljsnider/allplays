/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorState = vi.hoisted(() => ({
    isNative: true,
    platform: 'android',
    plugins: new Set(['FirebaseAuthentication'])
}));

const capacitorMock = vi.hoisted(() => ({
    isNativePlatform: () => capacitorState.isNative,
    getPlatform: () => capacitorState.platform,
    isPluginAvailable: (pluginName) => capacitorState.plugins.has(pluginName)
}));

const nativeAuthMocks = vi.hoisted(() => ({
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    getIdToken: vi.fn(),
    getCurrentUser: vi.fn(),
    deleteUser: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    auth: {
        currentUser: null,
        app: {
            name: '[DEFAULT]',
            options: {
                apiKey: 'test-api-key'
            }
        }
    },
    applyActionCode: vi.fn(),
    confirmPasswordReset: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    getRedirectResult: vi.fn(),
    GoogleAuthProvider: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    onAuthStateChanged: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    signInWithCredential: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    signInWithEmailLink: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn(),
    updatePassword: vi.fn(),
    verifyPasswordResetCode: vi.fn()
}));

const dbMocks = vi.hoisted(() => ({
    getTeam: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    markAccessCodeAsUsed: vi.fn(),
    redeemAdminInviteAtomically: vi.fn(),
    redeemHouseholdInvite: vi.fn(),
    redeemParentInvite: vi.fn(),
    updateTeam: vi.fn(),
    updateUserProfile: vi.fn(),
    validateAccessCode: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: capacitorMock
}));

vi.mock('../../apps/app/node_modules/@capacitor/core/dist/index.cjs.js', () => ({
    Capacitor: capacitorMock
}));

vi.mock('@capacitor-firebase/authentication', () => ({
    FirebaseAuthentication: nativeAuthMocks
}));

vi.mock('../../apps/app/node_modules/@capacitor-firebase/authentication/dist/plugin.cjs.js', () => ({
    FirebaseAuthentication: nativeAuthMocks
}));

vi.mock('../../js/firebase.js?v=19', () => firebaseMocks);
vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/admin-invite.js', () => ({
    redeemAdminInviteAcceptance: vi.fn()
}));
vi.mock('../../js/accept-invite-flow.js', () => ({
    createInviteProcessor: vi.fn()
}));
vi.mock('../../js/signup-flow.js', () => ({
    executeEmailPasswordSignup: vi.fn()
}));
vi.mock('../../js/parent-membership-utils.js', () => ({
    mergeApprovedParentMembershipRequests: vi.fn(() => ({ changed: false, userUpdate: {} }))
}));

function installFakeIndexedDb() {
    const savedRecords = new Map();
    const database = {
        objectStoreNames: {
            contains: vi.fn(() => false)
        },
        createObjectStore: vi.fn(),
        transaction: vi.fn(() => {
            const transaction = {
                error: null,
                onabort: null,
                oncomplete: null,
                onerror: null,
                objectStore: vi.fn(() => ({
                    delete: vi.fn(),
                    put: vi.fn((value) => {
                        savedRecords.set(value.fbase_key, value.value);
                    })
                }))
            };
            queueMicrotask(() => transaction.oncomplete?.());
            return transaction;
        }),
        close: vi.fn()
    };

    const indexedDB = {
        deleteDatabase: vi.fn(() => {
            const request = {
                error: null,
                onsuccess: null,
                onerror: null
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        }),
        open: vi.fn(() => {
            const request = {
                error: null,
                result: database,
                onerror: null,
                onsuccess: null,
                onupgradeneeded: null
            };
            queueMicrotask(() => {
                request.onupgradeneeded?.();
                request.onsuccess?.();
            });
            return request;
        })
    };

    Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: indexedDB
    });

    return {
        database,
        indexedDB,
        savedRecords
    };
}

function createMemoryStorage() {
    const records = new Map();
    return {
        clear: vi.fn(() => records.clear()),
        getItem: vi.fn((key) => records.get(String(key)) ?? null),
        removeItem: vi.fn((key) => records.delete(String(key))),
        setItem: vi.fn((key, value) => {
            records.set(String(key), String(value));
        })
    };
}

function mockFirebaseAuthRest({ isNewUser = false } = {}) {
    const fetchMock = vi.fn(async (url) => {
        const endpoint = String(url);
        if (endpoint.includes('accounts:signInWithIdp')) {
            return {
                ok: true,
                json: async () => ({
                    localId: 'native-google-user',
                    email: 'parent@example.com',
                    displayName: 'Parent User',
                    profilePicture: 'https://example.com/photo.png',
                    idToken: 'firebase-id-token',
                    refreshToken: 'firebase-refresh-token',
                    expiresIn: '3600',
                    isNewUser
                })
            };
        }

        if (endpoint.includes('accounts:lookup')) {
            return {
                ok: true,
                json: async () => ({
                    users: [{
                        email: 'parent@example.com',
                        emailVerified: true,
                        displayName: 'Parent User',
                        photoUrl: 'https://example.com/photo.png',
                        providerUserInfo: [{
                            providerId: 'google.com',
                            rawId: 'google-user',
                            email: 'parent@example.com',
                            displayName: 'Parent User',
                            photoUrl: 'https://example.com/photo.png'
                        }]
                    }]
                })
            };
        }

        throw new Error(`Unexpected Firebase Auth REST request: ${endpoint}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

async function loadAuthService() {
    vi.resetModules();
    return import('../../apps/app/src/lib/authService.ts');
}

beforeEach(() => {
    vi.clearAllMocks();
    capacitorState.isNative = true;
    capacitorState.platform = 'android';
    capacitorState.plugins = new Set(['FirebaseAuthentication']);
    firebaseMocks.auth.currentUser = null;
    dbMocks.updateUserProfile.mockResolvedValue(undefined);
    nativeAuthMocks.signInWithGoogle.mockResolvedValue({
        credential: {
            idToken: 'google-id-token',
            accessToken: 'google-access-token'
        }
    });
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: createMemoryStorage()
    });
    Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: createMemoryStorage()
    });
    installFakeIndexedDb();
    mockFirebaseAuthRest();
    window.localStorage.clear();
    window.sessionStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('React app native Google auth', () => {
    it('uses the previous Google account picker path on Android and stores a REST-backed app session', async () => {
        const { signInWithGoogleAccount } = await loadAuthService();

        const result = await signInWithGoogleAccount();

        expect(nativeAuthMocks.signInWithGoogle).toHaveBeenCalledWith({
            skipNativeAuth: true,
            useCredentialManager: false
        });
        expect(firebaseMocks.signInWithCredential).not.toHaveBeenCalled();
        expect(result?.nativeRest).toBe(true);
        expect(result?.user).toMatchObject({
            uid: 'native-google-user',
            email: 'parent@example.com',
            displayName: 'Parent User',
            emailVerified: true,
            isNativeRestSession: true
        });
        expect(dbMocks.updateUserProfile).toHaveBeenCalledWith('native-google-user', expect.objectContaining({
            email: 'parent@example.com',
            fullName: 'Parent User',
            photoUrl: 'https://example.com/photo.png'
        }));
        const savedSession = JSON.parse(window.localStorage.getItem('allplays-native-auth-session'));
        expect(savedSession).toMatchObject({
            uid: 'native-google-user',
            email: 'parent@example.com',
            idToken: 'firebase-id-token',
            refreshToken: 'firebase-refresh-token',
            provider: 'rest'
        });
    });

    it('keeps iOS on native Google sign-in without forcing Android Credential Manager options', async () => {
        capacitorState.platform = 'ios';
        const { signInWithGoogleAccount } = await loadAuthService();

        await signInWithGoogleAccount();

        expect(nativeAuthMocks.signInWithGoogle).toHaveBeenCalledWith({
            skipNativeAuth: true
        });
        expect(firebaseMocks.signInWithCredential).not.toHaveBeenCalled();
    });

    it('passes the native REST ID token when validating a new Google account activation code', async () => {
        mockFirebaseAuthRest({ isNewUser: true });
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            codeId: 'native-code',
            type: 'standard',
            data: { code: 'NATIVE123' }
        });
        dbMocks.markAccessCodeAsUsed.mockResolvedValue(undefined);
        dbMocks.updateUserProfile.mockResolvedValue(undefined);
        const { signInWithGoogleAccount } = await loadAuthService();

        await signInWithGoogleAccount('native123');

        expect(dbMocks.validateAccessCode).toHaveBeenCalledWith('NATIVE123', {
            nativeAuthToken: 'firebase-id-token'
        });
        expect(dbMocks.markAccessCodeAsUsed).toHaveBeenCalledWith('native-code', 'native-google-user');
    });
});
