import { expect, test } from '@playwright/test';

const probeFirebaseConfig = {
    apiKey: 'demo-cache-policy-key',
    authDomain: 'demo-allplays-cache-policy.firebaseapp.com',
    projectId: 'demo-allplays-cache-policy',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:cachepolicy'
};
const productionRuntimeHostnames = new Set([
    'allplays.ai',
    'www.allplays.ai',
    'game-flow-c6311.web.app',
    'game-flow-c6311.firebaseapp.com'
]);

function assertIsolatedBase(baseURL) {
    if (!baseURL) throw new Error('The Firestore cache policy smoke requires a base URL.');
    const hostname = new URL(baseURL).hostname;
    test.skip(
        productionRuntimeHostnames.has(hostname),
        'The cache policy smoke uses an isolated demo Firebase config and never targets production.'
    );
}

async function createProbeContext(browser, baseURL, {
    native = false,
    replayPrivacyStatus = { ready: false, cacheEpoch: null }
} = {}) {
    const baseOrigin = new URL(baseURL).origin;
    const externalRequests = [];
    const context = await browser.newContext();

    await context.addInitScript(({ firebaseConfig, nativeRuntime, privacyStatus }) => {
        globalThis.__ALLPLAYS_CONFIG__ = {
            firebase: firebaseConfig,
            appCheck: {
                enabled: false,
                isTokenAutoRefreshEnabled: true
            }
        };
        if (nativeRuntime) {
            globalThis.Capacitor = {
                isNativePlatform: () => true,
                getPlatform: () => 'android'
            };
        }
        globalThis.__REPLAY_PRIVACY_STATUS__ = privacyStatus;
        globalThis.__REPLAY_PRIVACY_CALLS__ = [];
    }, {
        firebaseConfig: probeFirebaseConfig,
        nativeRuntime: native,
        privacyStatus: replayPrivacyStatus
    });

    await context.route('**/*', async (route) => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.pathname === '/__firestore-cache-policy__') {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><html><head><meta charset="utf-8"></head><body>cache policy probe</body></html>'
            });
            return;
        }
        if (requestUrl.origin !== baseOrigin) {
            externalRequests.push(requestUrl.href);
            await route.abort('blockedbyclient');
            return;
        }
        await route.continue();
    });

    await context.route(/\/js\/vendor\/firebase-functions\.js$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
export function getFunctions() {
    return {};
}
export function httpsCallable(_functions, name) {
    return async () => {
        globalThis.__REPLAY_PRIVACY_CALLS__.push(name);
        return { data: globalThis.__REPLAY_PRIVACY_STATUS__ };
    };
}
`
        });
    });

    return { context, externalRequests };
}

function observePage(page, pageErrors, cacheWarnings) {
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        if (
            ['warning', 'error'].includes(message.type())
            && /primary lease|exclusive access|failed-precondition/i.test(message.text())
        ) {
            cacheWarnings.push(message.text());
        }
    });
}

async function runCacheProbe(page, baseURL, suffix, { previousEpoch = '' } = {}) {
    await page.goto(`${new URL(baseURL).origin}/__firestore-cache-policy__?probe=${suffix}`, {
        waitUntil: 'domcontentloaded'
    });
    return page.evaluate(async ({ probeSuffix, priorEpoch }) => {
        if (priorEpoch) {
            localStorage.setItem('allplays.firestore-cache-schema', priorEpoch);
        }
        const firebaseModule = await import(`/js/firebase.js?cache-policy=${probeSuffix}`);
        const firestoreModule = await import('/js/vendor/firebase-firestore.js');

        await firestoreModule.disableNetwork(firebaseModule.db);
        try {
            await firestoreModule.getDocFromCache(
                firestoreModule.doc(firebaseModule.db, '__cache_policy_probe__', probeSuffix)
            );
        } catch (error) {
            if (error?.code !== 'unavailable') throw error;
        }

        const databases = typeof indexedDB.databases === 'function'
            ? await indexedDB.databases()
            : [];
        const databaseNames = databases
            .map((database) => database.name || '')
            .filter((name) => name.startsWith('firestore/'));
        return {
            databaseNames,
            cacheEpoch: localStorage.getItem('allplays.firestore-cache-schema'),
            readinessCalls: [...globalThis.__REPLAY_PRIVACY_CALLS__]
        };
    }, { probeSuffix: suffix, priorEpoch: previousEpoch });
}

async function seedPendingNativeWrite(page, documentId) {
    await page.evaluate(async (pendingDocumentId) => {
        const firebaseModule = await import('/js/firebase.js?cache-policy=native-ready');
        const firestoreModule = await import('/js/vendor/firebase-firestore.js');
        const documentReference = firestoreModule.doc(
            firebaseModule.db,
            '__cache_policy_probe__',
            pendingDocumentId
        );

        await firestoreModule.disableNetwork(firebaseModule.db);
        void firestoreModule.setDoc(documentReference, {
            persistedAcrossReload: true
        }).catch(() => {});

        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
            try {
                const snapshot = await firestoreModule.getDocFromCache(documentReference);
                if (snapshot.exists()) return;
            } catch (error) {
                if (error?.code !== 'unavailable') throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Native pending write did not reach the persistent local cache.');
    }, documentId);
}

async function readNativeWriteAfterReload(page, documentId) {
    return page.evaluate(async (pendingDocumentId) => {
        const firebaseModule = await import('/js/firebase.js?cache-policy=native-ready');
        const firestoreModule = await import('/js/vendor/firebase-firestore.js');

        await firestoreModule.disableNetwork(firebaseModule.db);
        const snapshot = await firestoreModule.getDocFromCache(
            firestoreModule.doc(firebaseModule.db, '__cache_policy_probe__', pendingDocumentId)
        );
        return snapshot.data();
    }, documentId);
}

test('ordinary web tabs use isolated memory cache without a Firestore IndexedDB owner', async ({
    browser,
    baseURL
}) => {
    assertIsolatedBase(baseURL);
    const { context, externalRequests } = await createProbeContext(browser, baseURL, {
        replayPrivacyStatus: { ready: true, cacheEpoch: 'private-replay-v2' }
    });
    const pageErrors = [];
    const cacheWarnings = [];

    try {
        const pages = await Promise.all([context.newPage(), context.newPage()]);
        pages.forEach((page) => observePage(page, pageErrors, cacheWarnings));
        const probeResults = await Promise.all(
            pages.map((page, index) => runCacheProbe(page, baseURL, `web-${index}`))
        );

        expect(pageErrors, 'cache policy pages must boot without module errors').toEqual([]);
        expect(externalRequests, 'the offline cache probe must never contact a backend').toEqual([]);
        expect(cacheWarnings).toEqual([]);
        expect(probeResults.flatMap((result) => result.databaseNames)).toEqual([]);
        expect(probeResults.map((result) => result.readinessCalls)).toEqual([
            ['getReplayPrivacyMigrationStatus'],
            ['getReplayPrivacyMigrationStatus']
        ]);
    } finally {
        await context.close();
    }
});

test('Capacitor clears retired cache before readiness and persists only after the v2 gate', async ({
    browser,
    baseURL
}) => {
    assertIsolatedBase(baseURL);
    const preReadyProbe = await createProbeContext(browser, baseURL, {
        native: true,
        replayPrivacyStatus: { ready: false, cacheEpoch: null }
    });
    const preReadyErrors = [];
    const preReadyWarnings = [];
    const preReadyPage = await preReadyProbe.context.newPage();
    observePage(preReadyPage, preReadyErrors, preReadyWarnings);

    try {
        const preReadyResult = await runCacheProbe(
            preReadyPage,
            baseURL,
            'native-pre-ready',
            { previousEpoch: 'retired-replay-v1' }
        );

        expect(preReadyErrors, 'pre-ready native cache policy page must boot without module errors').toEqual([]);
        expect(preReadyProbe.externalRequests, 'the pre-ready cache probe must never contact a backend').toEqual([]);
        expect(preReadyWarnings).toEqual([]);
        expect(preReadyResult.databaseNames).toEqual([]);
        expect(preReadyResult.cacheEpoch).toBeNull();
        expect(preReadyResult.readinessCalls).toEqual(['getReplayPrivacyMigrationStatus']);
    } finally {
        await preReadyProbe.context.close();
    }

    const readyProbe = await createProbeContext(browser, baseURL, {
        native: true,
        replayPrivacyStatus: { ready: true, cacheEpoch: 'private-replay-v2' }
    });
    const readyErrors = [];
    const readyWarnings = [];
    const readyPage = await readyProbe.context.newPage();
    observePage(readyPage, readyErrors, readyWarnings);

    try {
        const readyResult = await runCacheProbe(
            readyPage,
            baseURL,
            'native-ready',
            { previousEpoch: 'retired-replay-v1' }
        );
        const pendingDocumentId = 'native-pending-write';
        await seedPendingNativeWrite(readyPage, pendingDocumentId);
        await readyPage.reload({ waitUntil: 'domcontentloaded' });
        const recoveredWrite = await readNativeWriteAfterReload(readyPage, pendingDocumentId);

        expect(readyErrors, 'ready native cache policy page must boot without module errors').toEqual([]);
        expect(readyProbe.externalRequests, 'the ready cache probe must never contact a backend').toEqual([]);
        expect(readyWarnings).toEqual([]);
        expect(readyResult.databaseNames.some((name) => name.startsWith('firestore/'))).toBe(true);
        expect(readyResult.cacheEpoch).toBe('private-replay-v2');
        expect(readyResult.readinessCalls).toEqual(['getReplayPrivacyMigrationStatus']);
        expect(recoveredWrite).toEqual({ persistedAcrossReload: true });
    } finally {
        await readyProbe.context.close();
    }
});
