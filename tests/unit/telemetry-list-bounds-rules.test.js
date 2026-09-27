import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    setDoc
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const telemetryCollections = [
    { collectionName: 'telemetryEvents', documentId: 'event-1', limit: 5000, loader: 'getTelemetryEvents', capSource: '5000' },
    { collectionName: 'telemetryDaily', documentId: '2030-06-01_s00', limit: 960, loader: 'getTelemetryDaily', capSource: '60 * TELEMETRY_AGGREGATE_SHARD_COUNT' },
    { collectionName: 'telemetryPagesDaily', documentId: '2030-06-01_admin_s00', limit: 16000, loader: 'getTelemetryPageDaily', capSource: '1000 * TELEMETRY_AGGREGATE_SHARD_COUNT' },
    { collectionName: 'telemetryRoutesDaily', documentId: '2030-06-01_admin_s00', limit: 16000, loader: 'getTelemetryRouteDaily', capSource: '1000 * TELEMETRY_AGGREGATE_SHARD_COUNT' },
    { collectionName: 'telemetryEventsDaily', documentId: '2030-06-01_page_view_s00', limit: 16000, loader: 'getTelemetryEventDaily', capSource: '1000 * TELEMETRY_AGGREGATE_SHARD_COUNT' },
    { collectionName: 'telemetrySessions', documentId: 'session-1', limit: 500, loader: 'getTelemetrySessions', capSource: '500' }
];

function extractMatchBlock(collectionName) {
    const start = rules.indexOf(`match /${collectionName}/`);
    const end = rules.indexOf('\n    }', start) + '\n    }'.length;
    expect(start).toBeGreaterThan(-1);
    return rules.slice(start, end);
}

function extractLoader(loaderName) {
    const start = dbSource.indexOf(`export async function ${loaderName}`);
    const nextLoader = dbSource.indexOf('\nexport async function ', start + 1);
    expect(start).toBeGreaterThan(-1);
    return dbSource.slice(start, nextLoader === -1 ? undefined : nextLoader);
}

describe('telemetry list query bounds', () => {
    it('separates admin document gets from collection-specific bounded lists', () => {
        const helperStart = rules.indexOf('function isBoundedGlobalAdminListQuery(maximumLimit)');
        const helperEnd = rules.indexOf('\n    }', helperStart) + '\n    }'.length;
        const helperRules = rules.slice(helperStart, helperEnd);

        expect(helperRules).toContain('request.query.limit != null');
        expect(helperRules).toContain('request.query.limit > 0');
        expect(helperRules).toContain('request.query.limit <= maximumLimit');

        for (const telemetry of telemetryCollections) {
            const matchBlock = extractMatchBlock(telemetry.collectionName);
            expect(matchBlock).toContain('allow get: if isGlobalAdmin();');
            expect(matchBlock).toContain(`allow list: if isBoundedGlobalAdminListQuery(${telemetry.limit});`);
            expect(matchBlock).not.toContain('allow read: if isGlobalAdmin();');
        }
    });

    it('keeps every dashboard telemetry loader at or below its rules ceiling', () => {
        expect(dbSource).toContain('const TELEMETRY_AGGREGATE_SHARD_COUNT = 16;');

        for (const telemetry of telemetryCollections) {
            const loader = extractLoader(telemetry.loader);
            expect(loader).toContain(`collection(db, '${telemetry.collectionName}')`);
            expect(loader).toContain('limitQuery(');
            expect(loader).toContain(telemetry.capSource);
        }
    });

    it('runs the telemetry rules-engine regression in the Firebase rules CI suite', () => {
        expect(packageJson.scripts['test:storage-rules:ci'])
            .toContain('tests/unit/telemetry-list-bounds-rules.test.js');
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('telemetry list bounds rules engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-telemetry-list-bounds-${Date.now()}`,
            firestore: { rules }
        });
    }, 30_000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(doc(firestore, 'users/admin-1'), {
                email: 'admin@example.com',
                isAdmin: true
            });
            await setDoc(doc(firestore, 'users/member-1'), {
                email: 'member@example.com',
                isAdmin: false
            });
            for (const telemetry of telemetryCollections) {
                await setDoc(doc(firestore, telemetry.collectionName, telemetry.documentId), {
                    seededForRulesTest: true
                });
            }
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    it('allows admin gets and at-cap lists while denying unbounded and over-cap lists', async () => {
        const adminDb = testEnv.authenticatedContext('admin-1', { email: 'admin@example.com' }).firestore();

        for (const telemetry of telemetryCollections) {
            await assertSucceeds(getDoc(doc(adminDb, telemetry.collectionName, telemetry.documentId)));
            await assertSucceeds(getDocs(query(
                collection(adminDb, telemetry.collectionName),
                limit(telemetry.limit)
            )));
            await assertFails(getDocs(collection(adminDb, telemetry.collectionName)));
            await assertFails(getDocs(query(
                collection(adminDb, telemetry.collectionName),
                limit(telemetry.limit + 1)
            )));
        }
    });

    it('denies non-admin document gets and bounded lists', async () => {
        const memberDb = testEnv.authenticatedContext('member-1', { email: 'member@example.com' }).firestore();

        for (const telemetry of telemetryCollections) {
            await assertFails(getDoc(doc(memberDb, telemetry.collectionName, telemetry.documentId)));
            await assertFails(getDocs(query(
                collection(memberDb, telemetry.collectionName),
                limit(telemetry.limit)
            )));
        }
    });
});
