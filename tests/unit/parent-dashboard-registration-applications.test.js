import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const firebaseMocks = vi.hoisted(() => ({
    auth: { currentUser: null },
    collectionGroup: vi.fn((_database, name) => ({ name })),
    doc: vi.fn((_database, ...segments) => ({ path: segments.join('/') })),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn((collectionRef, ...constraints) => ({ collectionRef, constraints })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    startAfter: vi.fn((value) => ({ type: 'startAfter', value })),
    documentId: vi.fn(() => '__name__')
}));

vi.mock('../../js/firebase.js?v=23', () => ({
    db: {},
    auth: firebaseMocks.auth,
    storage: {},
    collection: vi.fn(),
    getDocs: firebaseMocks.getDocs,
    getDoc: firebaseMocks.getDoc,
    doc: firebaseMocks.doc,
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: firebaseMocks.query,
    where: firebaseMocks.where,
    orderBy: firebaseMocks.orderBy,
    Timestamp: { now: vi.fn() },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: firebaseMocks.limit,
    startAfter: firebaseMocks.startAfter,
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: firebaseMocks.collectionGroup,
    documentId: firebaseMocks.documentId,
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: vi.fn(),
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase.js?v=22', async () => import('../../js/firebase.js?v=23'));

vi.mock('../../js/firebase-images.js?v=11', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

vi.mock('../../js/team-visibility.js?v=2', () => ({
    isTeamActive: vi.fn(() => true),
    filterTeamsByActive: vi.fn((teams) => teams),
    shouldIncludeTeamInLiveOrUpcoming: vi.fn(() => true),
    shouldIncludeTeamInReplay: vi.fn(() => true)
}));

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function createRegistrationDoc(number, options = {}) {
    const id = `registration-${String(number).padStart(2, '0')}`;
    const timestamp = new Date(`2026-07-${String(number).padStart(2, '0')}T12:00:00Z`);
    return {
        id,
        ref: { path: `teams/team-${number}/registrationForms/form-${number}/registrations/${id}` },
        data: () => ({
            teamId: `team-${number}`,
            formId: `form-${number}`,
            ...(options.createdAtOnly ? { createdAt: timestamp } : { submittedAt: timestamp, createdAt: timestamp }),
            participant: { name: `Player ${number}` },
            guardian: { email: 'parent@example.test' },
            status: 'pending',
            ...(options.legacy ? {} : { programName: `Program ${number}` })
        })
    };
}

function getQueryConstraint(queryValue, type) {
    return queryValue.constraints.find((constraint) => constraint.type === type);
}

const {
    listParentRegistrationApplicationsPage,
    PARENT_REGISTRATION_APPLICATION_PAGE_SIZE
} = await import('../../js/db.js?v=128-parent-registration-pagination');

describe('parent dashboard registration application pagination', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.getDoc.mockImplementation(async (reference) => {
            const isForm = reference.path.includes('/registrationForms/');
            const id = reference.path.split('/').at(-1);
            return {
                id,
                exists: () => true,
                data: () => isForm ? { title: 'Legacy program' } : { name: `Team ${id}` }
            };
        });
    });

    it('bounds both identity queries, deduplicates overlap, and advances independent cursors', async () => {
        const docs = new Map(Array.from({ length: 20 }, (_, index) => {
            const number = index + 1;
            return [number, createRegistrationDoc(number, { legacy: number === 1 })];
        }));
        const firstEmailPage = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2].map((number) => docs.get(number));
        const firstUserPage = [20, 19, 17, 15, 13, 11, 9, 7, 5, 3].map((number) => docs.get(number));

        firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
            const identity = getQueryConstraint(queryValue, 'where').field;
            const hasCursor = queryValue.constraints.some((constraint) => constraint.type === 'startAfter');
            if (identity === 'guardian.email') return { docs: hasCursor ? [docs.get(1)] : firstEmailPage };
            if (identity === 'submittedByUserId') return { docs: hasCursor ? [docs.get(1)] : firstUserPage };
            throw new Error(`Unexpected identity query: ${identity}`);
        });

        const profile = { id: 'parent-1', email: 'parent@example.test' };
        const firstPage = await listParentRegistrationApplicationsPage(profile);
        const secondPage = await listParentRegistrationApplicationsPage(profile, { cursor: firstPage.nextCursor });

        expect(PARENT_REGISTRATION_APPLICATION_PAGE_SIZE).toBe(10);
        expect(firstPage.applications.map((application) => application.id)).toEqual(
            Array.from({ length: 10 }, (_, index) => `registration-${20 - index}`)
        );
        expect(secondPage.applications.map((application) => application.id)).toEqual(
            Array.from({ length: 10 }, (_, index) => `registration-${String(10 - index).padStart(2, '0')}`)
        );
        expect(new Set([
            ...firstPage.applications.map((application) => application.id),
            ...secondPage.applications.map((application) => application.id)
        ]).size).toBe(20);
        expect(secondPage.hasMore).toBe(false);

        expect(firebaseMocks.limit).toHaveBeenCalledTimes(8);
        expect(firebaseMocks.limit).toHaveBeenCalledWith(10);
        expect(firebaseMocks.startAfter).toHaveBeenCalledTimes(4);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(docs.get(2));
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(docs.get(3));
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('submittedAt', 'desc');
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('__name__', 'desc');

        const formReads = firebaseMocks.getDoc.mock.calls.filter(([reference]) =>
            reference.path.includes('/registrationForms/')
        );
        const teamReads = firebaseMocks.getDoc.mock.calls.filter(([reference]) =>
            !reference.path.includes('/registrationForms/')
        );
        expect(teamReads).toHaveLength(20);
        expect(formReads).toHaveLength(1);
        expect(formReads[0][0].path).toBe('teams/team-1/registrationForms/form-1');
    });

    it('includes legacy registrations that have createdAt but no submittedAt', async () => {
        const legacyDoc = createRegistrationDoc(9, { createdAtOnly: true, legacy: true });
        firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
            const orderField = queryValue.constraints.find((constraint) =>
                constraint.type === 'orderBy' && constraint.field !== '__name__'
            ).field;
            return { docs: orderField === 'createdAt' ? [legacyDoc] : [] };
        });

        const page = await listParentRegistrationApplicationsPage({
            id: 'parent-1',
            email: 'parent@example.test'
        });

        expect(page.applications).toEqual([
            expect.objectContaining({
                id: 'registration-09',
                programName: 'Legacy program',
                submittedAt: legacyDoc.data().createdAt
            })
        ]);
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('submittedAt', 'desc');
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });

    it('returns available applications and retry metadata when one identity query or enrichment read fails', async () => {
        const registrationDoc = createRegistrationDoc(20);
        firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
            const identity = getQueryConstraint(queryValue, 'where').field;
            if (identity === 'submittedByUserId') throw new Error('missing index');
            return { docs: [registrationDoc] };
        });
        firebaseMocks.getDoc.mockRejectedValueOnce(new Error('team unavailable'));

        const page = await listParentRegistrationApplicationsPage({
            id: 'parent-1',
            email: 'parent@example.test'
        });

        expect(page.applications).toEqual([
            expect.objectContaining({
                id: 'registration-20',
                playerName: 'Player 20',
                programName: 'Program 20'
            })
        ]);
        expect(page.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ stage: 'query', source: 'userId' }),
            expect.objectContaining({ stage: 'team' })
        ]));
        expect(page.hasMore).toBe(true);
        expect(page.nextCursor).not.toBeNull();
    });

    it('advances successful sources through repeated failures and a later load-more page', async () => {
        const firstBatch = Array.from({ length: 10 }, (_, index) => createRegistrationDoc(30 - index));
        const secondBatch = Array.from({ length: 10 }, (_, index) => createRegistrationDoc(20 - index));
        const thirdBatch = Array.from({ length: 10 }, (_, index) => createRegistrationDoc(10 - index));
        let failuresActive = true;
        firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
            const identity = getQueryConstraint(queryValue, 'where').field;
            const orderField = queryValue.constraints.find((constraint) =>
                constraint.type === 'orderBy' && constraint.field !== '__name__'
            ).field;
            if (identity === 'submittedByUserId') {
                if (failuresActive) throw new Error('persistent identity failure');
                return { docs: [] };
            }
            if (orderField === 'createdAt') return { docs: [] };
            const cursor = queryValue.constraints.find((constraint) => constraint.type === 'startAfter')?.value;
            if (!cursor) return { docs: firstBatch };
            if (cursor === firstBatch.at(-1)) return { docs: secondBatch };
            if (cursor === secondBatch.at(-1)) return { docs: thirdBatch };
            return { docs: [] };
        });
        firebaseMocks.getDoc.mockImplementation(async (reference) => {
            if (failuresActive && reference.path.endsWith('/team-30')) throw new Error('persistent enrichment failure');
            const id = reference.path.split('/').at(-1);
            return { id, exists: () => true, data: () => ({ name: `Team ${id}` }) };
        });

        const profile = { id: 'parent-1', email: 'parent@example.test' };
        const firstPage = await listParentRegistrationApplicationsPage(profile);
        const secondPage = await listParentRegistrationApplicationsPage(profile, { cursor: firstPage.nextCursor });
        failuresActive = false;
        const recoveredPage = await listParentRegistrationApplicationsPage(profile, { cursor: secondPage.nextCursor });
        const loadMorePage = await listParentRegistrationApplicationsPage(profile, { cursor: recoveredPage.nextCursor });

        expect(firstPage.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ stage: 'query', source: 'userId' }),
            expect.objectContaining({ stage: 'team', registrationPath: firstBatch[0].ref.path })
        ]));
        expect(secondPage.applications.map((application) => application.id)).toEqual([
            'registration-30',
            ...secondBatch.map((registrationDoc) => registrationDoc.id)
        ]);
        expect(secondPage.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ stage: 'query', source: 'userId' }),
            expect.objectContaining({ stage: 'team', registrationPath: firstBatch[0].ref.path })
        ]));
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(firstBatch.at(-1));
        expect(secondPage.nextCursor.retryDocs).toEqual([firstBatch[0]]);
        expect(recoveredPage.errors).toEqual([]);
        expect(recoveredPage.hasMore).toBe(true);
        expect(recoveredPage.applications.map((application) => application.id)).toEqual([
            'registration-30',
            ...thirdBatch.map((registrationDoc) => registrationDoc.id)
        ]);
        expect(loadMorePage.errors).toEqual([]);
        expect(loadMorePage.hasMore).toBe(false);
    });

    it('wires registration-only loading, retry state, indexes, and read-only controls', () => {
        const html = readRepoFile('parent-dashboard.html');
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');
        const { indexes } = JSON.parse(readRepoFile('firestore.indexes.json'));

        expect(html).toContain('id="registration-applications-list"');
        expect(html).toContain('void loadNextRegistrationApplicationsPage()');
        expect(html).toContain('data-registration-action="load-more"');
        expect(html).toContain('data-registration-action="retry"');
        expect(html).toContain('Your existing applications are still shown.');
        expect(html).toContain('registrationApplicationsCursor = page.nextCursor;');
        expect(html).not.toContain('if (page.errors.length === 0)');
        expect(html).toContain("from './js/db.js?v=129';");
        expect(db).toContain("{ key: 'email', field: 'guardian.email', value: email }");
        expect(db).toContain("{ key: 'userId', field: 'submittedByUserId', value: userId }");
        expect(db).toContain("['submittedAt', 'createdAt']");
        expect(db).toContain('orderBy(source.orderField');
        expect(db).toContain('retryDocs: pendingRetryDocs');
        expect(db).toContain('if (!registration.programName && teamId && formId)');
        const dashboardLoaderStart = db.indexOf('export async function getParentDashboardData');
        const dashboardLoaderEnd = db.indexOf('\nexport async function ', dashboardLoaderStart + 1);
        const dashboardLoaderSource = db.slice(dashboardLoaderStart, dashboardLoaderEnd);
        expect(dashboardLoaderSource).not.toContain('listParentRegistrationApplicationsPage');
        expect(dashboardLoaderSource).not.toContain("collectionGroup(db, 'registrations')");

        const registrationIndexes = indexes.filter((index) =>
            index.collectionGroup === 'registrations' &&
            index.queryScope === 'COLLECTION_GROUP'
        );
        for (const identityField of ['guardian.email', 'submittedByUserId']) {
            for (const orderField of ['submittedAt', 'createdAt']) {
                expect(registrationIndexes).toContainEqual(expect.objectContaining({
                    fields: [
                        { fieldPath: identityField, order: 'ASCENDING' },
                        { fieldPath: orderField, order: 'DESCENDING' },
                        { fieldPath: '__name__', order: 'DESCENDING' }
                    ]
                }));
            }
        }

        expect(rules).toContain('isCurrentUserRegistrationGuardian(resource.data)');
        const registrationRules = rules.match(/match \/registrations\/\{registrationId\} \{[\s\S]*?allow create:/)[0];
        expect(registrationRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
        expect(registrationRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId);');
        expect(registrationRules).not.toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
    });
});
