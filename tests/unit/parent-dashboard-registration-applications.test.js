import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function buildTimestamp(milliseconds) {
    return {
        seconds: Math.floor(milliseconds / 1000),
        nanoseconds: (milliseconds % 1000) * 1000000,
        toMillis: () => milliseconds,
        toDate: () => new Date(milliseconds)
    };
}

function buildNanosecondTimestamp(seconds, nanoseconds) {
    return {
        seconds,
        nanoseconds,
        toMillis: () => (seconds * 1000) + Math.floor(nanoseconds / 1000000),
        toDate: () => new Date((seconds * 1000) + Math.floor(nanoseconds / 1000000))
    };
}

function buildRegistrationDocument(id, submittedAt, overrides = {}) {
    const registration = {
        teamId: `team-${id}`,
        formId: `form-${id}`,
        programName: `Program ${id}`,
        status: 'pending',
        submittedAt: buildTimestamp(submittedAt),
        ...overrides
    };
    return {
        id,
        ref: { path: `teams/${registration.teamId}/registrationForms/${registration.formId}/registrations/${id}` },
        data: () => registration
    };
}

function buildParentRegistrationApplicationsPageLoader({
    guardianDocuments = [],
    submitterDocuments = [],
    pageSize = 2,
    failIdentity = null,
    getTeamImplementation = async (teamId) => ({ id: teamId, name: `Team ${teamId}` }),
    getDocImplementation = async () => ({ exists: () => false, data: () => null })
} = {}) {
    const failedIdentities = new Set(failIdentity ? [failIdentity] : []);
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('export const PARENT_REGISTRATION_APPLICATION_PAGE_SIZE');
    const end = dbSource.indexOf('\nexport async function getParentDashboardData', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'export const PARENT_REGISTRATION_APPLICATION_PAGE_SIZE = 10;',
            'const PARENT_REGISTRATION_APPLICATION_PAGE_SIZE = pageSize;'
        )
        .replace(
            'export async function listParentRegistrationApplicationsPage',
            'return async function listParentRegistrationApplicationsPage'
        );
    const query = vi.fn((...parts) => parts);
    const where = vi.fn((fieldPath, operator, value) => ({ type: 'where', fieldPath, operator, value }));
    const orderBy = vi.fn((fieldPath, direction) => ({ type: 'orderBy', fieldPath, direction }));
    const limit = vi.fn((value) => ({ type: 'limit', value }));
    const startAfter = vi.fn((cursor) => ({ type: 'startAfter', cursor }));
    const getDocs = vi.fn(async (queryParts) => {
        const identityConstraint = queryParts.find((part) => part?.type === 'where');
        const identity = identityConstraint.fieldPath === 'guardian.email' ? 'guardian-email' : 'submitter-uid';
        if (failedIdentities.has(identity)) throw new Error(`${identity} failed`);
        const identitySource = identity === 'guardian-email' ? guardianDocuments : submitterDocuments;
        const ordersBySubmittedAt = queryParts.some((part) =>
            part?.type === 'orderBy' && part.fieldPath === 'submittedAt'
        );
        const source = ordersBySubmittedAt
            ? identitySource.filter((registrationDoc) => registrationDoc.data()?.submittedAt)
            : identitySource;
        const cursor = queryParts.find((part) => part?.type === 'startAfter')?.cursor;
        const queryLimit = queryParts.find((part) => part?.type === 'limit')?.value;
        const cursorIndex = cursor ? source.findIndex((registrationDoc) => registrationDoc === cursor) : -1;
        return { docs: source.slice(cursorIndex + 1, cursorIndex + 1 + queryLimit) };
    });
    const getTeam = vi.fn(getTeamImplementation);
    const getDoc = vi.fn(getDocImplementation);
    const dependencies = {
        pageSize,
        normalizeParentRegistrationEmail: (value = '') => String(value || '').trim().toLowerCase(),
        auth: { currentUser: null },
        query,
        collectionGroup: vi.fn(() => ({ type: 'collectionGroup' })),
        db: {},
        where,
        orderBy,
        documentId: vi.fn(() => '__name__'),
        limit,
        startAfter,
        getDocs,
        getTeam,
        getDoc,
        doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
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
        query,
        orderBy,
        limit,
        startAfter,
        getDocs,
        getTeam,
        getDoc,
        setIdentityFailure(identity, shouldFail) {
            if (shouldFail) {
                failedIdentities.add(identity);
            } else {
                failedIdentities.delete(identity);
            }
        }
    };
}

function buildMergeRegistrationApplicationPages() {
    const html = readRepoFile('parent-dashboard.html');
    const start = html.indexOf('function mergeRegistrationApplicationPages');
    const end = html.indexOf('\n\n        async function loadRegistrationApplications', start);
    return new Function(`${html.slice(start, end)}; return mergeRegistrationApplicationPages;`)();
}

describe('parent dashboard registration application statuses', () => {
    it('renders a read-only parent registration applications section from dashboard data', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('id="registration-applications-list"');
        expect(html).toContain('listParentRegistrationApplicationsPage,');
        expect(html).toContain('loadRegistrationApplications(user, { reset: true });');
        expect(html).not.toContain('await loadRegistrationApplications(user, { reset: true });');
        expect(html).toContain('cursor: pageCursor');
        expect(html).toContain('id="load-more-registration-applications"');
        expect(html).toContain('registrationApplicationRetryCursors');
        expect(html).toContain('id="retry-registration-application-details"');
        expect(html).toContain('loadRegistrationApplications(currentUser, { retryCursor });');
        expect(html).toContain('registration-applications-list');
        expect(html).toContain('offer-extended');
        expect(html).toContain('Status is read-only and controlled by the team admin.');
        expect(html).toContain("from './js/db.js?v=131';");
    });

    it('loads registrations by verified guardian email or authoritative submitter uid without exposing write controls', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');

        expect(db).toContain("collectionGroup(db, 'registrations')");
        expect(db).toContain("fieldPath: 'guardian.email'");
        expect(db).toContain("fieldPath: 'submittedByUserId'");
        expect(db).toContain("where(definition.fieldPath, '==', definition.value)");
        expect(db).toContain('documentsByKey');
        expect(db).toContain('listParentRegistrationApplicationsPage');
        expect(rules).toContain('isCurrentUserRegistrationGuardian(resource.data)');
        const registrationRules = rules.match(/match \/registrations\/\{registrationId\} \{[\s\S]*?allow create:/)[0];
        expect(registrationRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
        expect(registrationRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId);');
        expect(registrationRules).not.toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
    });

    it('uses the registration snapshot program name without reading its registration form', async () => {
        const registration = buildRegistrationDocument('registration-1', 10, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer'
        });
        const { loadPage, getDoc } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [registration]
        });

        const page = await loadPage({ email: 'parent@example.com' });

        expect(page.applications[0].programName).toBe('Spring Soccer');
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('reads the registration form once to resolve a legacy registration program name', async () => {
        const registration = buildRegistrationDocument('registration-1', 10, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: ''
        });
        const { loadPage, getDoc } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [registration],
            getDocImplementation: async () => ({
                exists: () => true,
                data: () => ({ programName: 'Legacy Soccer' })
            })
        });

        const page = await loadPage({ email: 'parent@example.com' });

        expect(page.applications[0].programName).toBe('Legacy Soccer');
        expect(getDoc).toHaveBeenCalledTimes(1);
    });

    it('loads fixed-size identity pages, merges overlaps, and advances both cursors without gaps', async () => {
        const overlap = buildRegistrationDocument('overlap', 40);
        const guardianDocuments = [
            buildRegistrationDocument('guardian-new', 60),
            overlap,
            buildRegistrationDocument('guardian-old', 10)
        ];
        const submitterDocuments = [
            buildRegistrationDocument('submitter-new', 60),
            overlap,
            buildRegistrationDocument('submitter-old', 20)
        ];
        const { loadPage, orderBy, limit, startAfter, getTeam } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments,
            submitterDocuments
        });
        const profile = { email: 'parent@example.com', uid: 'user-1' };

        const firstPage = await loadPage(profile);
        const secondPage = await loadPage(profile, { cursor: firstPage.nextCursor });
        const thirdPage = await loadPage(profile, { cursor: secondPage.nextCursor });
        const applicationIds = [
            ...firstPage.applications,
            ...secondPage.applications,
            ...thirdPage.applications
        ].map((application) => application.id);

        expect(firstPage.applications.map((application) => application.id)).toEqual([
            'submitter-new',
            'guardian-new'
        ]);
        expect(secondPage.applications.map((application) => application.id)).toEqual([
            'overlap',
            'submitter-old'
        ]);
        expect(thirdPage.applications.map((application) => application.id)).toEqual(['guardian-old']);
        expect(applicationIds).toEqual([
            'submitter-new',
            'guardian-new',
            'overlap',
            'submitter-old',
            'guardian-old'
        ]);
        expect(new Set(applicationIds).size).toBe(applicationIds.length);
        expect(firstPage.nextCursor.guardianEmail).toBe(guardianDocuments[0]);
        expect(firstPage.nextCursor.submittedByUserId).toBe(submitterDocuments[0]);
        expect(secondPage.nextCursor.guardianEmail).toBe(overlap);
        expect(secondPage.nextCursor.submittedByUserId).toBe(submitterDocuments[2]);
        expect(orderBy).toHaveBeenCalledWith('submittedAt', 'desc');
        expect(orderBy).toHaveBeenCalledWith('__name__', 'desc');
        expect(orderBy).toHaveBeenCalledTimes(12);
        expect(limit.mock.calls).toEqual(Array(6).fill([2]));
        expect(startAfter).toHaveBeenCalledWith(guardianDocuments[0]);
        expect(startAfter).toHaveBeenCalledWith(submitterDocuments[0]);
        expect(getTeam).toHaveBeenCalledTimes(5);
    });

    it('preserves Firestore nanosecond ordering when advancing a timestamped cursor', async () => {
        const newer = buildRegistrationDocument('a-newer', 0, {
            submittedAt: buildNanosecondTimestamp(100, 900)
        });
        const older = buildRegistrationDocument('z-older', 0, {
            submittedAt: buildNanosecondTimestamp(100, 100)
        });
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [newer, older],
            pageSize: 1
        });
        const profile = { email: 'parent@example.com' };

        const firstPage = await loadPage(profile);
        const secondPage = await loadPage(profile, { cursor: firstPage.nextCursor });

        expect(firstPage.applications.map((application) => application.id)).toEqual(['a-newer']);
        expect(firstPage.nextCursor.guardianEmail).toBe(newer);
        expect(secondPage.applications.map((application) => application.id)).toEqual(['z-older']);
    });

    it('enriches only the returned merged page', async () => {
        const { loadPage, getTeam } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [
                buildRegistrationDocument('guardian-1', 50),
                buildRegistrationDocument('guardian-2', 30)
            ],
            submitterDocuments: [
                buildRegistrationDocument('submitter-1', 40),
                buildRegistrationDocument('submitter-2', 20)
            ]
        });

        const page = await loadPage({ email: 'parent@example.com', uid: 'user-1' });

        expect(page.applications).toHaveLength(2);
        expect(getTeam).toHaveBeenCalledTimes(2);
    });

    it('preserves successful applications and reports retryable query and enrichment errors', async () => {
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [buildRegistrationDocument('guardian-1', 50)],
            submitterDocuments: [buildRegistrationDocument('submitter-1', 40)],
            failIdentity: 'submitter-uid',
            getTeamImplementation: async () => {
                throw new Error('team read failed');
            }
        });

        const page = await loadPage({ email: 'parent@example.com', uid: 'user-1' });

        expect(page.applications).toHaveLength(1);
        expect(page.applications[0]).toMatchObject({
            id: 'guardian-1',
            teamName: 'Team registration'
        });
        expect(page.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'parent-registration-query-failed',
                identity: 'submitter-uid',
                retryable: true
            }),
            expect.objectContaining({
                code: 'parent-registration-enrichment-failed',
                identity: 'team:team-guardian-1',
                retryable: true
            })
        ]));
    });

    it.each([
        ['team', 'teamName', 'Recovered Team'],
        ['form', 'programName', 'Recovered Program']
    ])('retries the same page after a failed %s enrichment', async (failedEnrichment, recoveredField, recoveredValue) => {
        let failEnrichment = true;
        const priorRegistration = buildRegistrationDocument('prior-registration', 60);
        const registration = buildRegistrationDocument('registration-1', 50, {
            programName: failedEnrichment === 'form' ? '' : 'Program One'
        });
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [priorRegistration, registration],
            getTeamImplementation: async (teamId) => {
                if (failedEnrichment === 'team' && failEnrichment) throw new Error('team read failed');
                return { id: teamId, name: 'Recovered Team' };
            },
            getDocImplementation: async () => {
                if (failedEnrichment === 'form' && failEnrichment) throw new Error('form read failed');
                return { exists: () => true, data: () => ({ programName: 'Recovered Program' }) };
            }
        });
        const profile = { email: 'parent@example.com' };
        const retryCursor = { guardianEmail: priorRegistration };

        const failedPage = await loadPage(profile, { cursor: retryCursor });
        expect(failedPage.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'parent-registration-enrichment-failed',
                retryable: true
            })
        ]));
        expect(failedPage.nextCursor).not.toBeNull();

        failEnrichment = false;
        const recoveredPage = await loadPage(profile, { cursor: retryCursor });

        expect(recoveredPage.errors).toEqual([]);
        expect(recoveredPage.applications[0][recoveredField]).toBe(recoveredValue);
    });

    it('declares collection-group indexes for both bounded identity queries', () => {
        const indexes = JSON.parse(readRepoFile('firestore.indexes.json')).indexes;
        const registrationIndexes = indexes.filter((index) => index.collectionGroup === 'registrations'
            && index.queryScope === 'COLLECTION_GROUP');

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

    it('keeps the production loader limit fixed', () => {
        expect(readRepoFile('js/db.js')).toContain('export const PARENT_REGISTRATION_APPLICATION_PAGE_SIZE = 10;');
    });

    it('switches to a bounded document-id scan so legacy registrations without submittedAt remain visible', async () => {
        const legacyRegistration = buildRegistrationDocument('legacy', 0, { submittedAt: undefined });
        const { loadPage, orderBy, limit } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [legacyRegistration],
            submitterDocuments: []
        });
        const profile = { email: 'parent@example.com', uid: 'user-1' };

        const timestampedPage = await loadPage(profile);
        const legacyPage = await loadPage(profile, { cursor: timestampedPage.nextCursor });

        expect(timestampedPage.applications).toEqual([]);
        expect(timestampedPage.hasMore).toBe(true);
        expect(timestampedPage.nextCursor.legacy.active).toBe(true);
        expect(legacyPage.applications.map((application) => application.id)).toEqual(['legacy']);
        expect(orderBy).toHaveBeenCalledWith('__name__', 'desc');
        expect(limit).toHaveBeenCalledWith(2);
    });

    it('advances legacy cursors only through the consumed merge prefix for disjoint full identity pages', async () => {
        const guardianDocuments = [
            buildRegistrationDocument('z-guardian-1', 0, { submittedAt: undefined }),
            buildRegistrationDocument('y-guardian-2', 0, { submittedAt: undefined })
        ];
        const submitterDocuments = [
            buildRegistrationDocument('b-submitter-1', 0, { submittedAt: undefined }),
            buildRegistrationDocument('a-submitter-2', 0, { submittedAt: undefined })
        ];
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments,
            submitterDocuments
        });
        const profile = { email: 'parent@example.com', uid: 'user-1' };
        const legacyCursor = {
            guardianEmail: null,
            submittedByUserId: null,
            legacy: {
                active: true,
                guardianEmail: null,
                submittedByUserId: null
            }
        };

        const firstPage = await loadPage(profile, { cursor: legacyCursor });
        const secondPage = await loadPage(profile, { cursor: firstPage.nextCursor });
        const applicationIds = [...firstPage.applications, ...secondPage.applications]
            .map((application) => application.id);

        expect(firstPage.applications.map((application) => application.id)).toEqual([
            'z-guardian-1',
            'y-guardian-2'
        ]);
        expect(firstPage.nextCursor.legacy.guardianEmail).toBe(guardianDocuments[1]);
        expect(firstPage.nextCursor.legacy.submittedByUserId).toBeNull();
        expect(secondPage.applications.map((application) => application.id)).toEqual([
            'b-submitter-1',
            'a-submitter-2'
        ]);
        expect(applicationIds).toEqual([
            'z-guardian-1',
            'y-guardian-2',
            'b-submitter-1',
            'a-submitter-2'
        ]);
        expect(new Set(applicationIds).size).toBe(4);
    });

    it.each([
        ['guardian-email', 'submitter-uid'],
        ['submitter-uid', 'guardian-email']
    ])('deduplicates an overlapping application when %s recovers after %s advanced', async (
        recoveringIdentity,
        successfulIdentity
    ) => {
        const overlap = buildRegistrationDocument('overlap', 50);
        const guardianDocuments = [overlap];
        const submitterDocuments = [overlap];
        const loader = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments,
            submitterDocuments,
            failIdentity: recoveringIdentity
        });
        const mergePages = buildMergeRegistrationApplicationPages();
        const profile = { email: 'parent@example.com', uid: 'user-1' };

        const partialPage = await loader.loadPage(profile);
        expect(partialPage.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ identity: recoveringIdentity })
        ]));
        const successfulCursorKey = successfulIdentity === 'guardian-email'
            ? 'guardianEmail'
            : 'submittedByUserId';
        expect(partialPage.nextCursor[successfulCursorKey]).toBe(overlap);

        loader.setIdentityFailure(recoveringIdentity, false);
        const recoveredPage = await loader.loadPage(profile, { cursor: partialPage.nextCursor });
        const mergedApplications = mergePages(partialPage.applications, recoveredPage.applications);

        expect(partialPage.applications.map((application) => application.id)).toEqual(['overlap']);
        expect(recoveredPage.applications.map((application) => application.id)).toEqual(['overlap']);
        expect(mergedApplications.map((application) => application.id)).toEqual(['overlap']);
        expect(mergedApplications[0].registrationKey).toBe(overlap.ref.path);
    });

    it('keeps appended and recovered applications duplicate-free and newest-first', () => {
        const mergePages = buildMergeRegistrationApplicationPages();
        const older = {
            id: 'older',
            registrationKey: 'registrations/older',
            submittedAt: buildTimestamp(1000)
        };
        const overlap = {
            id: 'overlap',
            registrationKey: 'registrations/overlap',
            submittedAt: buildTimestamp(2000),
            teamName: 'Initial Team'
        };
        const recoveredOverlap = {
            ...overlap,
            teamName: 'Recovered Team'
        };
        const recoveredNewer = {
            id: 'newer',
            registrationKey: 'registrations/newer',
            submittedAt: buildTimestamp(3000)
        };

        const firstAppend = mergePages([], [overlap, older]);
        const secondAppend = mergePages(firstAppend, [recoveredOverlap, recoveredNewer]);

        expect(secondAppend.map((application) => application.id)).toEqual([
            'newer',
            'overlap',
            'older'
        ]);
        expect(secondAppend).toHaveLength(3);
        expect(secondAppend[1].teamName).toBe('Recovered Team');
    });

    it('starts registration paging after player render without rerunning dashboard bootstrap', () => {
        const html = readRepoFile('parent-dashboard.html');
        const initSource = html.slice(
            html.indexOf('async function init()'),
            html.indexOf('\n\n        function getParentDashboardStateMessage')
        );
        const registrationLoaderSource = html.slice(
            html.indexOf('async function loadRegistrationApplications'),
            html.indexOf('\n\n        function renderRegistrationApplications')
        );

        expect(initSource.match(/getParentDashboardData\(user\.uid\)/g)).toHaveLength(1);
        expect(initSource.indexOf('renderPlayers(data.children, data.dashboardState || null);'))
            .toBeLessThan(initSource.indexOf('loadRegistrationApplications(user, { reset: true });'));
        expect(initSource).not.toContain('await loadRegistrationApplications(user, { reset: true });');
        expect(registrationLoaderSource).not.toContain('getParentDashboardData');
        expect(html).toContain("loadRegistrationApplications(currentUser);");
    });

    it('preserves the legacy createdAt submission date during enrichment', async () => {
        const createdAt = buildTimestamp(1000);
        const legacyRegistration = buildRegistrationDocument('legacy-created-at', 0, {
            submittedAt: undefined,
            createdAt
        });
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [legacyRegistration]
        });
        const legacyCursor = {
            legacy: {
                active: true,
                guardianEmail: null,
                submittedByUserId: null
            }
        };

        const page = await loadPage({ email: 'parent@example.com' }, { cursor: legacyCursor });

        expect(page.applications[0].submittedAt).toBe(createdAt);
    });

    it('does not eagerly load full registration history as part of dashboard data', () => {
        const db = readRepoFile('js/db.js');
        const dashboardDataSource = db.slice(
            db.indexOf('export async function getParentDashboardData'),
            db.indexOf('export async function updatePlayerProfile')
        );

        expect(dashboardDataSource).not.toContain('registrationApplications');
    });
});
