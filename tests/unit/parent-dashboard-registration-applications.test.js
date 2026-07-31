import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function buildListParentRegistrationApplicationsForProfile({
    registration,
    form = null
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
        query: vi.fn((...parts) => parts),
        collectionGroup: vi.fn(),
        db: {},
        where: vi.fn(),
        getDocs: vi.fn().mockResolvedValue({
            docs: [{
                id: 'registration-1',
                ref: { path: 'teams/team-1/registrationForms/form-1/registrations/registration-1' },
                data: () => registration
            }]
        }),
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

    return { listApplications, getDoc };
}

function buildTimestamp(milliseconds) {
    return {
        toMillis: () => milliseconds,
        toDate: () => new Date(milliseconds)
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
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('export const PARENT_REGISTRATION_APPLICATION_PAGE_SIZE');
    const end = dbSource.indexOf('\nasync function listParentRegistrationApplicationsForProfile', start);
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
        if (identity === failIdentity) throw new Error(`${identity} failed`);
        const source = identity === 'guardian-email' ? guardianDocuments : submitterDocuments;
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

    return { loadPage, query, orderBy, limit, startAfter, getDocs, getTeam, getDoc };
}

describe('parent dashboard registration application statuses', () => {
    it('renders a read-only parent registration applications section from dashboard data', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('id="registration-applications-list"');
        expect(html).toContain('renderRegistrationApplications(data.registrationApplications || [])');
        expect(html).toContain('registration-applications-list');
        expect(html).toContain('offer-extended');
        expect(html).toContain('Status is read-only and controlled by the team admin.');
        expect(html).toContain("from './js/db.js?v=129';");
    });

    it('loads registrations by verified guardian email or authoritative submitter uid without exposing write controls', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');

        expect(db).toContain("collectionGroup(db, 'registrations')");
        expect(db).toContain("where('guardian.email', '==', email)");
        expect(db).toContain("where('submittedByUserId', '==', userId)");
        expect(db).toContain('seenRegistrationPaths');
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
});
