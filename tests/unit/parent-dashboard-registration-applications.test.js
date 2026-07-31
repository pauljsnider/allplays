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
    const end = dbSource.indexOf('\nasync function listParentRegistrationApplicationsForProfile', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'export function mergeParentRegistrationQueryResults',
            'return function mergeParentRegistrationQueryResults'
        );
    return new Function(functionSource)();
}

function buildParentRegistrationIdentityQueryHelpers({ docs = [] } = {}) {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('export const PARENT_REGISTRATION_IDENTITY_QUERY_LIMIT');
    const end = dbSource.indexOf('\nfunction getParentRegistrationDocumentKey', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'export const PARENT_REGISTRATION_IDENTITY_QUERY_LIMIT = 10;',
            'const PARENT_REGISTRATION_IDENTITY_QUERY_LIMIT = 10;'
        )
        .replaceAll('export async function ', 'async function ');
    const query = vi.fn((...parts) => parts);
    const where = vi.fn((fieldPath, operator, value) => ({ type: 'where', fieldPath, operator, value }));
    const orderBy = vi.fn((fieldPath, direction) => ({ type: 'orderBy', fieldPath, direction }));
    const limit = vi.fn((value) => ({ type: 'limit', value }));
    const startAfter = vi.fn((cursor) => ({ type: 'startAfter', cursor }));
    const getDocs = vi.fn().mockResolvedValue({ docs });
    const dependencies = {
        query,
        collectionGroup: vi.fn(() => ({ type: 'collectionGroup' })),
        db: {},
        where,
        orderBy,
        documentId: vi.fn(() => '__name__'),
        limit,
        startAfter,
        getDocs,
        normalizeParentRegistrationEmail: (value = '') => String(value || '').trim().toLowerCase()
    };
    const dependencyNames = Object.keys(dependencies);
    const buildHelpers = new Function(
        ...dependencyNames,
        `${functionSource}
        return {
            listParentRegistrationsByGuardianEmailPage,
            listParentRegistrationsBySubmitterUidPage
        };`
    );
    const helpers = buildHelpers(...dependencyNames.map((name) => dependencies[name]));

    return { ...helpers, dependencies };
}

function buildListParentRegistrationApplicationsForProfile({
    registration,
    form = null,
    guardianPages,
    submitterPages
}) {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('async function listAllParentRegistrationIdentityPages');
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
    const defaultDocument = {
        id: 'registration-1',
        ref: { path: 'teams/team-1/registrationForms/form-1/registrations/registration-1' },
        data: () => registration
    };
    function buildPageLoader(pages = [{ docs: [defaultDocument], hasMore: false, nextCursor: defaultDocument }]) {
        return vi.fn().mockImplementation(async (_identity, cursor) => {
            const pageIndex = cursor ? pages.findIndex((page) => page.nextCursor === cursor) + 1 : 0;
            return pages[pageIndex] || { docs: [], hasMore: false, nextCursor: cursor };
        });
    }
    const listParentRegistrationsByGuardianEmailPage = buildPageLoader(guardianPages);
    const listParentRegistrationsBySubmitterUidPage = buildPageLoader(submitterPages);
    const dependencies = {
        normalizeParentRegistrationEmail: (value = '') => String(value || '').trim().toLowerCase(),
        auth: { currentUser: null },
        db: {},
        listParentRegistrationsByGuardianEmailPage,
        listParentRegistrationsBySubmitterUidPage,
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

describe('parent dashboard registration application statuses', () => {
    it('renders a read-only parent registration applications section from dashboard data', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('id="registration-applications-list"');
        expect(html).toContain('renderRegistrationApplications(data.registrationApplications || [])');
        expect(html).toContain('registration-applications-list');
        expect(html).toContain('offer-extended');
        expect(html).toContain('Status is read-only and controlled by the team admin.');
        expect(html).toContain("from './js/db.js?v=131';");
    });

    it.each([
        ['guardian email', 'listParentRegistrationsByGuardianEmailPage', ' Parent@Example.com ', 'guardian.email', 'parent@example.com'],
        ['submitter uid', 'listParentRegistrationsBySubmitterUidPage', ' user-1 ', 'submittedByUserId', 'user-1']
    ])('builds a bounded submittedAt-descending %s query', async (
        _identity,
        helperName,
        identityValue,
        expectedFieldPath,
        expectedValue
    ) => {
        const { [helperName]: loadPage, dependencies } = buildParentRegistrationIdentityQueryHelpers();

        await loadPage(identityValue);

        expect(dependencies.where).toHaveBeenCalledWith(expectedFieldPath, '==', expectedValue);
        expect(dependencies.orderBy).toHaveBeenNthCalledWith(1, 'submittedAt', 'desc');
        expect(dependencies.orderBy).toHaveBeenNthCalledWith(2, '__name__', 'desc');
        expect(dependencies.limit).toHaveBeenCalledWith(10);
        expect(dependencies.startAfter).not.toHaveBeenCalled();
        expect(dependencies.query).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['listParentRegistrationsByGuardianEmailPage', 'parent@example.com'],
        ['listParentRegistrationsBySubmitterUidPage', 'user-1']
    ])('applies and advances the previous cursor for %s', async (helperName, identityValue) => {
        const previousCursor = { id: 'previous-registration' };
        const lastDocument = { id: 'last-registration' };
        const { [helperName]: loadPage, dependencies } = buildParentRegistrationIdentityQueryHelpers({
            docs: [{ id: 'first-registration' }, lastDocument]
        });

        const page = await loadPage(identityValue, previousCursor);

        expect(dependencies.startAfter).toHaveBeenCalledWith(previousCursor);
        expect(page.docs).toHaveLength(2);
        expect(page.nextCursor).toBe(lastDocument);
        expect(page.hasMore).toBe(false);
    });

    it('declares collection-group indexes for both bounded identity queries', () => {
        const indexes = JSON.parse(readRepoFile('firestore.indexes.json')).indexes;
        const registrationIndexes = indexes.filter((index) =>
            index.collectionGroup === 'registrations'
            && index.queryScope === 'COLLECTION_GROUP'
        );

        expect(registrationIndexes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                fields: [
                    { fieldPath: 'guardian.email', order: 'ASCENDING' },
                    { fieldPath: 'submittedAt', order: 'DESCENDING' },
                    { fieldPath: '__name__', order: 'DESCENDING' }
                ]
            }),
            expect.objectContaining({
                fields: [
                    { fieldPath: 'submittedByUserId', order: 'ASCENDING' },
                    { fieldPath: 'submittedAt', order: 'DESCENDING' },
                    { fieldPath: '__name__', order: 'DESCENDING' }
                ]
            })
        ]));
    });

    it('loads registrations by verified guardian email or authoritative submitter uid without exposing write controls', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');
        const functionStart = db.indexOf('async function listParentRegistrationApplicationsForProfile');
        const functionEnd = db.indexOf('\nexport async function getParentDashboardData', functionStart);
        const functionSource = db.slice(functionStart, functionEnd);

        expect(db).toContain("collectionGroup(db, 'registrations')");
        expect(functionSource).toContain('listParentRegistrationsByGuardianEmailPage(email, cursor)');
        expect(functionSource).toContain('listParentRegistrationsBySubmitterUidPage(userId, cursor)');
        expect(functionSource).toContain('mergeParentRegistrationQueryResults(');
        expect(functionSource).toContain('listAllParentRegistrationIdentityPages(loadPage)');
        expect(db).toContain('registrationApplications');
        expect(rules).toContain('isCurrentUserRegistrationGuardian(resource.data)');
        const registrationRules = rules.match(/match \/registrations\/\{registrationId\} \{[\s\S]*?allow create:/)[0];
        expect(registrationRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
        expect(registrationRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId);');
        expect(registrationRules).not.toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
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

    it('merges the production identity queries without excluding legacy submittedAt values', async () => {
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
        const { listApplications, dependencies } = buildListParentRegistrationApplicationsForProfile({
            registration: canonical.data(),
            guardianPages: [{
                docs: [missingDate, stringDate, canonical],
                hasMore: false,
                nextCursor: canonical
            }],
            submitterPages: [{
                docs: [canonical, createdAtFallback],
                hasMore: false,
                nextCursor: createdAtFallback
            }]
        });

        const applications = await listApplications({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications.map((application) => application.id)).toEqual(
            ['canonical', 'string-date', 'created-at-fallback', 'missing-date']
        );
        expect(dependencies.listParentRegistrationsByGuardianEmailPage).toHaveBeenCalledWith('parent@example.com', null);
        expect(dependencies.listParentRegistrationsBySubmitterUidPage).toHaveBeenCalledWith('parent-1', null);
    });

    it('assembles registration applications from every bounded identity page', async () => {
        const newest = buildRegistrationDocument('newest', 300, { programName: 'Spring Soccer' });
        const guardianCursor = buildRegistrationDocument('guardian-cursor', 200, { programName: 'Spring Soccer' });
        const oldest = buildRegistrationDocument('oldest', 100, { programName: 'Spring Soccer' });
        const { listApplications, dependencies } = buildListParentRegistrationApplicationsForProfile({
            registration: newest.data(),
            guardianPages: [
                { docs: [newest, guardianCursor], hasMore: true, nextCursor: guardianCursor },
                { docs: [oldest], hasMore: false, nextCursor: oldest }
            ],
            submitterPages: []
        });

        const applications = await listApplications({ email: 'parent@example.com' });

        expect(applications.map((application) => application.id)).toEqual(['newest', 'guardian-cursor', 'oldest']);
        expect(dependencies.listParentRegistrationsByGuardianEmailPage).toHaveBeenNthCalledWith(1, 'parent@example.com', null);
        expect(dependencies.listParentRegistrationsByGuardianEmailPage).toHaveBeenNthCalledWith(2, 'parent@example.com', guardianCursor);
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
        const { listApplications, dependencies } = buildListParentRegistrationApplicationsForProfile({
            registration: registrationDoc.data(),
            guardianPages: [],
            submitterPages: [{ docs: [registrationDoc], hasMore: false, nextCursor: registrationDoc }]
        });
        dependencies.listParentRegistrationsByGuardianEmailPage.mockRejectedValueOnce(new Error('guardian index unavailable'));

        const applications = await listApplications({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications.map((application) => application.id)).toEqual(['submitter-match']);
    });
});
