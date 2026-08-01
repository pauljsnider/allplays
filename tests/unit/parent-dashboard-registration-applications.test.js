import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function buildTimestamp(seconds, nanoseconds = 0) {
    return {
        seconds,
        nanoseconds,
        toMillis: () => (seconds * 1000) + Math.floor(nanoseconds / 1000000)
    };
}

function buildRegistrationDocument(id, seconds, overrides = {}) {
    const registration = {
        teamId: `team-${id}`,
        formId: `form-${id}`,
        submittedAt: buildTimestamp(seconds),
        ...overrides
    };
    return {
        id,
        ref: {
            path: `teams/${registration.teamId}/registrationForms/${registration.formId}/registrations/${id}`
        },
        data: () => registration
    };
}

function buildMergeParentRegistrationQueryResults() {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('function getParentRegistrationDocumentKey');
    const end = dbSource.indexOf('\nexport const PARENT_REGISTRATION_APPLICATION_PAGE_SIZE', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'export function mergeParentRegistrationQueryResults',
            'return function mergeParentRegistrationQueryResults'
        );
    return new Function(functionSource)();
}

function buildRegistrationIdentityQueryHelpers(getDocs) {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('export const PARENT_REGISTRATION_IDENTITY_QUERY_LIMIT');
    const end = dbSource.indexOf('\nfunction getParentRegistrationDocumentKey', start);
    const functionSource = `${dbSource.slice(start, end)
        .replace('export const PARENT_REGISTRATION_IDENTITY_QUERY_LIMIT', 'const PARENT_REGISTRATION_IDENTITY_QUERY_LIMIT')
        .replace('export async function queryRegistrationsByGuardianEmail', 'async function queryRegistrationsByGuardianEmail')
        .replace('export async function queryRegistrationsBySubmitterUid', 'async function queryRegistrationsBySubmitterUid')}
return { queryRegistrationsByGuardianEmail, queryRegistrationsBySubmitterUid };`;
    const dependencies = {
        normalizeParentRegistrationEmail: (value = '') => String(value || '').trim().toLowerCase(),
        where: vi.fn((fieldPath, operator, value) => ({ type: 'where', fieldPath, operator, value })),
        orderBy: vi.fn((fieldPath, direction) => ({ type: 'orderBy', fieldPath, direction })),
        documentId: vi.fn(() => '__name__'),
        startAfterQuery: vi.fn((cursor) => ({ type: 'startAfter', cursor })),
        limitQuery: vi.fn((value) => ({ type: 'limit', value })),
        getDocs,
        query: vi.fn((...parts) => parts),
        collectionGroup: vi.fn(() => ({ type: 'collectionGroup' })),
        db: {}
    };
    const dependencyNames = Object.keys(dependencies);
    const helpers = new Function(...dependencyNames, functionSource)(
        ...dependencyNames.map((name) => dependencies[name])
    );

    return { ...helpers, dependencies };
}

function buildListParentRegistrationApplicationsForProfile({
    registration,
    form = null,
    queryRegistrationsByGuardianEmail = null,
    queryRegistrationsBySubmitterUid = null,
    getDocs = vi.fn().mockResolvedValue({
        docs: [{
            id: 'registration-1',
            ref: { path: 'teams/team-1/registrationForms/form-1/registrations/registration-1' },
            data: () => registration
        }]
    })
}) {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('async function listParentRegistrationApplicationsForProfile');
    const end = dbSource.indexOf('\nexport async function getParentDashboardData', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'async function listParentRegistrationApplicationsForProfile',
            'return async function listParentRegistrationApplicationsForProfile'
        );
    const getDoc = vi.fn().mockResolvedValue({
        exists: () => form !== null,
        data: () => form
    });
    const dependencies = {
        normalizeParentRegistrationEmail: (value = '') => String(value || '').trim().toLowerCase(),
        auth: { currentUser: null },
        db: {},
        getDocs,
        queryRegistrationsByGuardianEmail: queryRegistrationsByGuardianEmail
            || vi.fn(async () => ({ snapshot: await getDocs(), cursor: null, hasMore: false })),
        queryRegistrationsBySubmitterUid: queryRegistrationsBySubmitterUid
            || vi.fn(async () => ({ snapshot: await getDocs(), cursor: null, hasMore: false })),
        mergeParentRegistrationQueryResults: buildMergeParentRegistrationQueryResults(),
        getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Team One' }),
        getDoc,
        doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
        getRegistrationPlayerDraft: vi.fn().mockReturnValue({ name: 'Player One' }),
        getRegistrationGuardianDrafts: vi.fn().mockReturnValue([{ email: 'parent@example.com' }]),
        normalizeRegistrationStatus: (status = '') => status || 'pending',
        formatParentRegistrationStatusLabel: () => 'Pending Review'
    };
    const dependencyNames = Object.keys(dependencies);
    const listApplications = new Function(...dependencyNames, functionSource)(
        ...dependencyNames.map((name) => dependencies[name])
    );

    return { listApplications, getDoc, dependencies };
}

function buildParentRegistrationApplicationsPageLoader({
    guardianDocuments = [],
    submitterDocuments = [],
    pageSize = 2,
    failIdentity = null,
    getTeamImplementation = async (teamId) => ({ id: teamId, name: `Team ${teamId}` }),
    getDocImplementation = async () => ({ exists: () => false, data: () => null })
} = {}) {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('function buildParentRegistrationError');
    const end = dbSource.indexOf('\nasync function listParentRegistrationApplicationsForProfile', start);
    const functionSource = dbSource.slice(start, end).replace(
        'export async function listParentRegistrationApplicationsPage',
        'return async function listParentRegistrationApplicationsPage'
    );
    const loadIdentityPage = async (identity, source, cursor) => {
        if (identity === failIdentity) throw new Error(`${identity} failed`);
        const docs = source.slice(0, pageSize);
        return {
            snapshot: { docs },
            cursor: docs.at(-1) || cursor || null,
            hasMore: source.length > pageSize
        };
    };
    const queryRegistrationsByGuardianEmail = vi.fn((_email, cursor) => (
        loadIdentityPage('guardian-email', guardianDocuments, cursor)
    ));
    const queryRegistrationsBySubmitterUid = vi.fn((_userId, cursor) => (
        loadIdentityPage('submitter-uid', submitterDocuments, cursor)
    ));
    const getTeam = vi.fn(getTeamImplementation);
    const getDoc = vi.fn(getDocImplementation);
    const dependencies = {
        PARENT_REGISTRATION_APPLICATION_PAGE_SIZE: pageSize,
        normalizeParentRegistrationEmail: (value = '') => String(value || '').trim().toLowerCase(),
        auth: { currentUser: null },
        queryRegistrationsByGuardianEmail,
        queryRegistrationsBySubmitterUid,
        mergeParentRegistrationQueryResults: buildMergeParentRegistrationQueryResults(),
        getParentRegistrationDocumentKey: (registrationDoc) => registrationDoc.ref?.path || registrationDoc.id,
        getTeam,
        getDoc,
        doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
        db: {},
        getRegistrationPlayerDraft: vi.fn().mockReturnValue({ name: 'Player One' }),
        getRegistrationGuardianDrafts: vi.fn().mockReturnValue([{ email: 'parent@example.com' }]),
        normalizeRegistrationStatus: (status = '') => status || 'pending',
        formatParentRegistrationStatusLabel: () => 'Pending Review'
    };
    const dependencyNames = Object.keys(dependencies);
    const loadPage = new Function(...dependencyNames, functionSource)(
        ...dependencyNames.map((name) => dependencies[name])
    );

    return {
        loadPage,
        getTeam,
        getDoc,
        queryRegistrationsByGuardianEmail,
        queryRegistrationsBySubmitterUid
    };
}

function buildMergeRegistrationApplications() {
    const html = readRepoFile('parent-dashboard.html');
    const start = html.indexOf('function getRegistrationApplicationKey');
    const end = html.indexOf('\n        async function loadRegistrationApplicationsPage', start);
    return new Function(`${html.slice(start, end)}\nreturn mergeRegistrationApplications;`)();
}

function buildRegistrationApplicationsPageLoader(listParentRegistrationApplicationsPage) {
    const html = readRepoFile('parent-dashboard.html');
    const start = html.indexOf('async function loadRegistrationApplicationsPage');
    const end = html.indexOf('\n        function renderRegistrationApplications', start);
    const functionSource = html.slice(start, end);
    return new Function('listParentRegistrationApplicationsPage', `
        let registrationUser = { uid: 'parent-1' };
        let registrationApplications = [];
        let registrationNextCursor = null;
        let registrationRetryCursor = null;
        let registrationRetryAvailable = false;
        let registrationErrors = [];
        let registrationLoadInFlight = false;
        const mergeRegistrationApplications = (existing, incoming) => [...existing, ...incoming];
        const renderRegistrationApplications = () => {};
        ${functionSource}
        return {
            loadRegistrationApplicationsPage,
            getRetryState: () => ({
                available: registrationRetryAvailable,
                cursor: registrationRetryCursor
            })
        };
    `)(listParentRegistrationApplicationsPage);
}

describe('parent dashboard registration application statuses', () => {
    it('loads the bounded first registration page without blocking or rerunning dashboard bootstrap', () => {
        const html = readRepoFile('parent-dashboard.html');
        const db = readRepoFile('js/db.js');
        const initStart = html.indexOf('async function init()');
        const initEnd = html.indexOf('\n        function getParentDashboardStateMessage', initStart);
        const initSource = html.slice(initStart, initEnd);
        const loaderStart = html.indexOf('async function loadInitialRegistrationApplications');
        const loaderEnd = html.indexOf('\n        function renderRegistrationApplications', loaderStart);
        const loaderSource = html.slice(loaderStart, loaderEnd);
        const dashboardStart = db.indexOf('export async function getParentDashboardData');
        const dashboardEnd = db.indexOf('\nexport async function updatePlayerProfile', dashboardStart);
        const dashboardSource = db.slice(dashboardStart, dashboardEnd);

        expect(html).toContain('id="registration-applications-list"');
        expect(html).toContain('listParentRegistrationApplicationsPage,');
        expect(initSource).toContain('renderPlayers(data.children, data.dashboardState || null);');
        expect(initSource).toContain('void loadInitialRegistrationApplications(user);');
        expect(initSource).not.toContain('await loadInitialRegistrationApplications(user)');
        expect(initSource.match(/loadInitialRegistrationApplications\(user\)/g)).toHaveLength(1);
        expect(loaderSource).toContain('await loadRegistrationApplicationsPage(null);');
        expect(dashboardSource).not.toContain('listParentRegistrationApplicationsForProfile');
        expect(dashboardSource).not.toContain('registrationApplications');
        expect(html).toContain('registration-applications-list');
        expect(html).toContain('offer-extended');
        expect(html).toContain('Status is read-only and controlled by the team admin.');
        expect(html).toContain("from './js/db.js?v=137';");
    });

    it('shows a registration-specific error without replacing successful applications', () => {
        const html = readRepoFile('parent-dashboard.html');
        const loaderStart = html.indexOf('async function loadRegistrationApplicationsPage');
        const loaderEnd = html.indexOf('\n        function renderRegistrationApplications', loaderStart);
        const loaderSource = html.slice(loaderStart, loaderEnd);

        expect(() => new Function(loaderSource)).not.toThrow();
        expect(loaderSource).toContain('listParentRegistrationApplicationsPage(registrationUser, { cursor })');
        expect(loaderSource).toContain('registrationApplications = mergeRegistrationApplications(');
        expect(loaderSource).toContain('registrationRetryAvailable = true;');
        expect(loaderSource).toContain('registrationRetryCursor = cursor;');
        expect(html).toContain('Registration applications could not be loaded. Retry this registration page.');
        expect(html).toContain("const errorHtml = errors.length > 0");
        expect(html).toContain('id="registration-retry-btn"');
    });

    it('retries an initial-page exception with the original null cursor', async () => {
        const listPage = vi.fn()
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce({ applications: [], errors: [], nextCursor: null });
        const loader = buildRegistrationApplicationsPageLoader(listPage);

        await loader.loadRegistrationApplicationsPage(null);

        expect(loader.getRetryState()).toEqual({ available: true, cursor: null });

        await loader.loadRegistrationApplicationsPage(loader.getRetryState().cursor);

        expect(listPage).toHaveBeenNthCalledWith(2, { uid: 'parent-1' }, { cursor: null });
        expect(loader.getRetryState()).toEqual({ available: false, cursor: null });
    });

    it('appends registration pages newest-first without rerunning dashboard bootstrap', () => {
        const html = readRepoFile('parent-dashboard.html');
        const loaderStart = html.indexOf('async function loadRegistrationApplicationsPage');
        const loaderEnd = html.indexOf('\n        function renderRegistrationApplications', loaderStart);
        const loaderSource = html.slice(loaderStart, loaderEnd);
        const mergeStart = html.indexOf('function mergeRegistrationApplications');
        const mergeEnd = html.indexOf('\n        async function loadRegistrationApplicationsPage', mergeStart);
        const mergeSource = html.slice(mergeStart, mergeEnd);

        expect(loaderSource).toContain('page.nextCursor || null');
        expect(loaderSource).not.toContain('getParentDashboardData');
        expect(mergeSource).toContain('new Map()');
        expect(mergeSource).toContain('getRegistrationApplicationSubmittedAt(b)');
        expect(html).toContain('id="registration-load-more-btn"');
        expect(html).toContain('void loadRegistrationApplicationsPage(registrationNextCursor);');
    });

    it('merges appended applications newest-first and replaces duplicate identities', () => {
        const mergeApplications = buildMergeRegistrationApplications();
        const firstPage = [
            { id: 'newest', registrationKey: 'registrations/newest', submittedAt: '2026-07-03T00:00:00Z' },
            { id: 'duplicate', registrationKey: 'registrations/duplicate', submittedAt: '2026-07-02T00:00:00Z', statusLabel: 'Pending' }
        ];
        const nextPage = [
            { id: 'oldest', registrationKey: 'registrations/oldest', submittedAt: '2026-07-01T00:00:00Z' },
            { id: 'duplicate', registrationKey: 'registrations/duplicate', submittedAt: '2026-07-02T00:00:00Z', statusLabel: 'Enrolled' }
        ];

        const merged = mergeApplications(firstPage, nextPage);

        expect(merged.map((application) => application.id)).toEqual(['newest', 'duplicate', 'oldest']);
        expect(merged.find((application) => application.id === 'duplicate').statusLabel).toBe('Enrolled');
    });

    it('loads registrations by verified guardian email or authoritative submitter uid without exposing write controls', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');
        const functionStart = db.indexOf('async function listParentRegistrationApplicationsForProfile');
        const functionEnd = db.indexOf('\nexport async function getParentDashboardData', functionStart);
        const functionSource = db.slice(functionStart, functionEnd);

        expect(db).toContain("collectionGroup(db, 'registrations')");
        expect(functionSource).toContain('queryRegistrationsByGuardianEmail(email, cursor)');
        expect(functionSource).toContain('queryRegistrationsBySubmitterUid(userId, cursor)');
        expect(functionSource).toContain('mergeParentRegistrationQueryResults(');
        expect(db).toContain('listParentRegistrationApplicationsPage');
        expect(rules).toContain('isCurrentUserRegistrationGuardian(resource.data)');
        const registrationRules = rules.match(/match \/registrations\/\{registrationId\} \{[\s\S]*?allow create:/)[0];
        expect(registrationRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
        expect(registrationRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId);');
        expect(registrationRules).not.toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
    });

    it('builds fixed-size document-id identity queries that include records without submittedAt', async () => {
        const guardianLast = buildRegistrationDocument('guardian-last', 200);
        const submitterLast = buildRegistrationDocument('submitter-last', 100);
        const guardianPreviousCursor = buildRegistrationDocument('guardian-previous', 300);
        const submitterPreviousCursor = buildRegistrationDocument('submitter-previous', 250);
        const getDocs = vi.fn()
            .mockResolvedValueOnce({ docs: [guardianLast] })
            .mockResolvedValueOnce({ docs: [submitterLast] });
        const {
            queryRegistrationsByGuardianEmail,
            queryRegistrationsBySubmitterUid,
            dependencies
        } = buildRegistrationIdentityQueryHelpers(getDocs);

        const guardianPage = await queryRegistrationsByGuardianEmail(' Parent@Example.com ', guardianPreviousCursor);
        const submitterPage = await queryRegistrationsBySubmitterUid(' user-1 ', submitterPreviousCursor);

        expect(dependencies.where.mock.calls).toEqual([
            ['guardian.email', '==', 'parent@example.com'],
            ['submittedByUserId', '==', 'user-1']
        ]);
        expect(dependencies.orderBy.mock.calls).toEqual([
            ['__name__', 'desc'],
            ['__name__', 'desc']
        ]);
        expect(dependencies.limitQuery.mock.calls).toEqual([[10], [10]]);
        expect(dependencies.startAfterQuery.mock.calls).toEqual([
            [guardianPreviousCursor],
            [submitterPreviousCursor]
        ]);
        expect(dependencies.query.mock.calls[0].slice(1).map((constraint) => constraint.type)).toEqual([
            'where',
            'orderBy',
            'startAfter',
            'limit'
        ]);
        expect(dependencies.query.mock.calls[1].slice(1).map((constraint) => constraint.type)).toEqual([
            'where',
            'orderBy',
            'startAfter',
            'limit'
        ]);
        expect(guardianPage.cursor).toBe(guardianLast);
        expect(submitterPage.cursor).toBe(submitterLast);
        expect(guardianPage.hasMore).toBe(false);
        expect(submitterPage.hasMore).toBe(false);
    });

    it('declares the composite collection-group indexes used by both identity queries', () => {
        const indexes = JSON.parse(readRepoFile('firestore.indexes.json')).indexes;
        const registrationIndexes = indexes.filter((index) => index.collectionGroup === 'registrations'
            && index.queryScope === 'COLLECTION_GROUP');

        expect(registrationIndexes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                fields: [
                    { fieldPath: 'guardian.email', order: 'ASCENDING' },
                    { fieldPath: '__name__', order: 'DESCENDING' }
                ]
            }),
            expect.objectContaining({
                fields: [
                    { fieldPath: 'submittedByUserId', order: 'ASCENDING' },
                    { fieldPath: '__name__', order: 'DESCENDING' }
                ]
            })
        ]));
    });

    it('uses the registration snapshot program name without reading its registration form', async () => {
        const { listApplications, getDoc } = buildListParentRegistrationApplicationsForProfile({
            registration: {
                teamId: 'team-1',
                formId: 'form-1',
                programName: 'Spring Soccer',
                status: 'pending'
            }
        });

        const applications = await listApplications({ email: 'parent@example.com' });

        expect(applications[0].programName).toBe('Spring Soccer');
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('reads the registration form once to resolve a legacy registration program name', async () => {
        const { listApplications, getDoc } = buildListParentRegistrationApplicationsForProfile({
            registration: {
                teamId: 'team-1',
                formId: 'form-1',
                status: 'pending'
            },
            form: { programName: 'Legacy Soccer' }
        });

        const applications = await listApplications({ email: 'parent@example.com' });

        expect(applications[0].programName).toBe('Legacy Soccer');
        expect(getDoc).toHaveBeenCalledTimes(1);
    });

    it('merges bounded identity snapshots using legacy submittedAt sort fallbacks', async () => {
        const canonical = buildRegistrationDocument('canonical', 300, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer'
        });
        const stringDate = buildRegistrationDocument('string-date', 0, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer',
            submittedAt: '1970-01-01T00:03:20.000Z'
        });
        const createdAtFallback = buildRegistrationDocument('created-at-fallback', 0, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer',
            submittedAt: undefined,
            createdAt: buildTimestamp(100)
        });
        const missingDate = buildRegistrationDocument('missing-date', 0, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer',
            submittedAt: undefined
        });
        const getDocs = vi.fn()
            .mockResolvedValueOnce({ docs: [missingDate, stringDate, canonical] })
            .mockResolvedValueOnce({ docs: [canonical, createdAtFallback] });
        const { listApplications, dependencies } = buildListParentRegistrationApplicationsForProfile({
            registration: canonical.data(),
            getDocs
        });

        const applications = await listApplications({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications.map((application) => application.id)).toEqual(
            ['canonical', 'string-date', 'created-at-fallback', 'missing-date']
        );
        expect(getDocs).toHaveBeenCalledTimes(2);
        expect(dependencies.queryRegistrationsByGuardianEmail).toHaveBeenCalledWith('parent@example.com', null);
        expect(dependencies.queryRegistrationsBySubmitterUid).toHaveBeenCalledWith('parent-1', null);
    });

    it('loads every page from both identity streams and retains legacy records', async () => {
        const guardianDocuments = Array.from({ length: 11 }, (_, index) => buildRegistrationDocument(
            `guardian-${index + 1}`,
            300 - index,
            {
                teamId: 'team-1',
                formId: 'form-1',
                programName: 'Spring Soccer'
            }
        ));
        const legacySubmitterDocument = buildRegistrationDocument('legacy-submitter', 0, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer',
            submittedAt: undefined,
            createdAt: buildTimestamp(100)
        });
        const queryGuardian = vi.fn(async (_email, cursor) => cursor
            ? { snapshot: { docs: guardianDocuments.slice(10) }, cursor: guardianDocuments[10], hasMore: false }
            : { snapshot: { docs: guardianDocuments.slice(0, 10) }, cursor: guardianDocuments[9], hasMore: true });
        const querySubmitter = vi.fn(async () => ({
            snapshot: { docs: [guardianDocuments[0], legacySubmitterDocument] },
            cursor: legacySubmitterDocument,
            hasMore: false
        }));
        const { listApplications } = buildListParentRegistrationApplicationsForProfile({
            registration: guardianDocuments[0].data(),
            queryRegistrationsByGuardianEmail: queryGuardian,
            queryRegistrationsBySubmitterUid: querySubmitter
        });

        const applications = await listApplications({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications).toHaveLength(12);
        expect(applications.map((application) => application.id)).toContain('guardian-11');
        expect(applications.map((application) => application.id)).toContain('legacy-submitter');
        expect(queryGuardian).toHaveBeenNthCalledWith(1, 'parent@example.com', null);
        expect(queryGuardian).toHaveBeenNthCalledWith(2, 'parent@example.com', guardianDocuments[9]);
        expect(querySubmitter).toHaveBeenCalledWith('parent-1', null);
    });

    it('deduplicates overlapping identity matches across complete query results', () => {
        const mergeResults = buildMergeParentRegistrationQueryResults();
        const newest = buildRegistrationDocument('newest', 60);
        const overlap = buildRegistrationDocument('overlap', 50);
        const guardianOnly = buildRegistrationDocument('guardian-only', 40);

        const registrations = mergeResults([
            { docs: [guardianOnly, overlap, newest] },
            { docs: [overlap, newest] }
        ]);

        expect(registrations.map((registrationDoc) => registrationDoc.id)).toEqual([
            'newest',
            'overlap',
            'guardian-only'
        ]);
    });

    it('uses document path descending as a deterministic submittedAt tie-breaker', () => {
        const mergeResults = buildMergeParentRegistrationQueryResults();
        const alpha = buildRegistrationDocument('alpha', 50, {
            submittedAt: buildTimestamp(50, 100)
        });
        const omega = buildRegistrationDocument('omega', 50, {
            submittedAt: buildTimestamp(50, 100)
        });

        const registrations = mergeResults([{ docs: [alpha] }, { docs: [omega] }]);

        expect(registrations.map((registrationDoc) => registrationDoc.id)).toEqual([
            'omega',
            'alpha'
        ]);
    });

    it('orders Timestamp, string, createdAt fallback, invalid, and missing dates without dropping records', () => {
        const mergeResults = buildMergeParentRegistrationQueryResults();
        const registrations = mergeResults([{
            docs: [
                buildRegistrationDocument('missing', 0, { submittedAt: undefined }),
                buildRegistrationDocument('invalid', 0, { submittedAt: 'not-a-date' }),
                buildRegistrationDocument('created-at', 0, {
                    submittedAt: undefined,
                    createdAt: buildTimestamp(100)
                }),
                buildRegistrationDocument('string', 0, {
                    submittedAt: '1970-01-01T00:03:20.000Z'
                }),
                buildRegistrationDocument('timestamp', 300)
            ]
        }]);

        expect(registrations.map((registrationDoc) => registrationDoc.id)).toEqual([
            'timestamp',
            'string',
            'created-at',
            'missing',
            'invalid'
        ]);
    });

    it('returns the successful identity query when the other lookup fails', async () => {
        const registrationDoc = buildRegistrationDocument('submitter-match', 100, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer'
        });
        const getDocs = vi.fn()
            .mockRejectedValueOnce(new Error('guardian index unavailable'))
            .mockResolvedValueOnce({ docs: [registrationDoc] });
        const { listApplications } = buildListParentRegistrationApplicationsForProfile({
            registration: registrationDoc.data(),
            getDocs
        });

        const applications = await listApplications({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications.map((application) => application.id)).toEqual(['submitter-match']);
    });

    it('enriches only registrations selected for the bounded merged page', async () => {
        const guardianDocuments = [
            buildRegistrationDocument('guardian-1', 50),
            buildRegistrationDocument('guardian-2', 30)
        ];
        const submitterDocuments = [
            buildRegistrationDocument('submitter-1', 40),
            buildRegistrationDocument('submitter-2', 20)
        ];
        const {
            loadPage,
            getTeam,
            getDoc,
            queryRegistrationsByGuardianEmail,
            queryRegistrationsBySubmitterUid
        } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments,
            submitterDocuments
        });

        const page = await loadPage({ email: 'parent@example.com', uid: 'user-1' });

        expect(page.applications.map((application) => application.id)).toEqual([
            'guardian-1',
            'submitter-1'
        ]);
        expect(getTeam).toHaveBeenCalledTimes(page.applications.length);
        expect(getTeam).not.toHaveBeenCalledWith('team-guardian-2');
        expect(getTeam).not.toHaveBeenCalledWith('team-submitter-2');
        expect(getDoc).toHaveBeenCalledTimes(page.applications.length);
        expect(getDoc.mock.calls.some(([formRef]) => formRef.path.includes('guardian-2'))).toBe(false);
        expect(getDoc.mock.calls.some(([formRef]) => formRef.path.includes('submitter-2'))).toBe(false);
        expect(queryRegistrationsByGuardianEmail).toHaveBeenCalledTimes(1);
        expect(queryRegistrationsBySubmitterUid).toHaveBeenCalledTimes(1);
    });

    it('preserves the successful identity query and reports the failed query as retryable', async () => {
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [buildRegistrationDocument('guardian-1', 50, { programName: 'Program One' })],
            submitterDocuments: [buildRegistrationDocument('submitter-1', 40, { programName: 'Program Two' })],
            failIdentity: 'submitter-uid'
        });

        const page = await loadPage({ email: 'parent@example.com', uid: 'user-1' });

        expect(page.applications.map((application) => application.id)).toEqual(['guardian-1']);
        expect(page.errors).toEqual([
            expect.objectContaining({
                code: 'parent-registration-query-failed',
                identity: 'submitter-uid',
                retryable: true
            })
        ]);
        expect(page.retryCursor).toEqual({});
    });

    it('preserves selected registrations when one team enrichment read fails', async () => {
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [
                buildRegistrationDocument('failed', 50, { programName: 'Program One' }),
                buildRegistrationDocument('successful', 40, { programName: 'Program Two' })
            ],
            getTeamImplementation: async (teamId) => {
                if (teamId === 'team-failed') throw new Error('team read failed');
                return { id: teamId, name: 'Loaded Team' };
            }
        });

        const page = await loadPage({ email: 'parent@example.com' });

        expect(page.applications).toHaveLength(2);
        expect(page.applications[0]).toMatchObject({ id: 'failed', teamName: 'Team registration' });
        expect(page.applications[1]).toMatchObject({ id: 'successful', teamName: 'Loaded Team' });
        expect(page.errors).toEqual([
            expect.objectContaining({
                code: 'parent-registration-enrichment-failed',
                identity: 'team:team-failed',
                registrationId: 'failed',
                registrationKey: expect.stringContaining('/failed'),
                retryable: true
            })
        ]);
        expect(page.retryCursor).toEqual({});
    });

    it('preserves selected registrations when one form enrichment read fails', async () => {
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [
                buildRegistrationDocument('failed', 50),
                buildRegistrationDocument('successful', 40)
            ],
            getDocImplementation: async (formRef) => {
                if (formRef.path.includes('form-failed')) throw new Error('form read failed');
                return {
                    exists: () => true,
                    data: () => ({ programName: 'Loaded Program' })
                };
            }
        });

        const page = await loadPage({ email: 'parent@example.com' });

        expect(page.applications).toHaveLength(2);
        expect(page.applications[0]).toMatchObject({ id: 'failed', programName: 'Registration' });
        expect(page.applications[1]).toMatchObject({ id: 'successful', programName: 'Loaded Program' });
        expect(page.errors).toEqual([
            expect.objectContaining({
                code: 'parent-registration-enrichment-failed',
                identity: 'form:team-failed::form-failed',
                registrationId: 'failed',
                registrationKey: expect.stringContaining('/failed'),
                retryable: true
            })
        ]);
        expect(page.retryCursor).toEqual({});
    });
});
