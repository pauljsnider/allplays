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

function buildRegistrationDocument(id, submittedAt, overrides = {}) {
    const registration = {
        teamId: `team-${id}`,
        formId: `form-${id}`,
        programName: `Program ${id}`,
        status: 'pending',
        submittedAt: { toMillis: () => submittedAt },
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
    const startAfter = vi.fn((queryCursor) => ({ type: 'startAfter', cursor: queryCursor }));
    const getDocs = vi.fn(async (queryParts) => {
        const identityConstraint = queryParts.find((part) => part?.type === 'where');
        const identity = identityConstraint.fieldPath === 'guardian.email' ? 'guardian-email' : 'submitter-uid';
        if (identity === failIdentity) throw new Error(`${identity} failed`);
        const source = identity === 'guardian-email' ? guardianDocuments : submitterDocuments;
        const queryLimit = queryParts.find((part) => part?.type === 'limit')?.value;
        return { docs: source.slice(0, queryLimit) };
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

    return { loadPage, limit, getTeam, getDoc };
}

function buildParentDashboardData({
    userProfile = { id: 'user-1', email: 'parent@example.com', parentOf: [] },
    registrationPage = { applications: [], nextCursor: null, retryCursor: null, hasMore: false, errors: [] }
} = {}) {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('export async function getParentDashboardData');
    const end = dbSource.indexOf('\nexport async function updatePlayerProfile', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'export async function getParentDashboardData',
            'return async function getParentDashboardData'
        );
    const listParentRegistrationApplicationsPage = vi.fn().mockResolvedValue(registrationPage);
    const dependencies = {
        getUserProfile: vi.fn().mockResolvedValue(userProfile),
        listMyParentMembershipRequests: vi.fn().mockResolvedValue([]),
        mergeApprovedParentMembershipRequests: vi.fn().mockReturnValue({ changed: false }),
        updateUserProfile: vi.fn(),
        listParentRegistrationApplicationsPage,
        normalizeParentScopeLinks: vi.fn(),
        getEvents: vi.fn()
    };
    const dependencyNames = Object.keys(dependencies);
    const getParentDashboardData = new Function(...dependencyNames, functionSource)(
        ...dependencyNames.map((name) => dependencies[name])
    );

    return { getParentDashboardData, listParentRegistrationApplicationsPage };
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

    it('enriches only registrations selected for the bounded merged page', async () => {
        const { loadPage, limit, getTeam } = buildParentRegistrationApplicationsPageLoader({
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

        expect(page.applications.map((application) => application.id)).toEqual([
            'guardian-1',
            'submitter-1'
        ]);
        expect(getTeam).toHaveBeenCalledTimes(page.applications.length);
        expect(getTeam).not.toHaveBeenCalledWith('team-guardian-2');
        expect(getTeam).not.toHaveBeenCalledWith('team-submitter-2');
        expect(limit.mock.calls).toEqual([[2], [2]]);
    });

    it('uses the bounded registration page in the production parent dashboard data flow', async () => {
        const registrationApplications = [{ id: 'registration-1', programName: 'Spring Soccer' }];
        const { getParentDashboardData, listParentRegistrationApplicationsPage } = buildParentDashboardData({
            registrationPage: {
                applications: registrationApplications,
                nextCursor: null,
                retryCursor: null,
                hasMore: false,
                errors: []
            }
        });

        const dashboard = await getParentDashboardData('user-1');

        expect(listParentRegistrationApplicationsPage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-1', email: 'parent@example.com' })
        );
        expect(dashboard.registrationApplications).toBe(registrationApplications);
    });

    it('preserves the successful identity query and reports the failed query as retryable', async () => {
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [buildRegistrationDocument('guardian-1', 50)],
            submitterDocuments: [buildRegistrationDocument('submitter-1', 40)],
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

    it('preserves all selected registrations when one team enrichment read fails', async () => {
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [
                buildRegistrationDocument('failed', 50),
                buildRegistrationDocument('successful', 40)
            ],
            getTeamImplementation: async (teamId) => {
                if (teamId === 'team-failed') throw new Error('team read failed');
                return { id: teamId, name: 'Loaded Team' };
            }
        });

        const page = await loadPage({ email: 'parent@example.com' });

        expect(page.applications).toHaveLength(2);
        expect(page.applications[0]).toMatchObject({
            id: 'failed',
            teamName: 'Team registration'
        });
        expect(page.applications[1]).toMatchObject({
            id: 'successful',
            teamName: 'Loaded Team'
        });
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

    it('preserves all selected registrations when one form enrichment read fails', async () => {
        const { loadPage } = buildParentRegistrationApplicationsPageLoader({
            guardianDocuments: [
                buildRegistrationDocument('failed', 50, { programName: '' }),
                buildRegistrationDocument('successful', 40, { programName: '' })
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
        expect(page.applications[0]).toMatchObject({
            id: 'failed',
            programName: 'Registration'
        });
        expect(page.applications[1]).toMatchObject({
            id: 'successful',
            programName: 'Loaded Program'
        });
        expect(page.errors).toEqual([
            expect.objectContaining({
                code: 'parent-registration-enrichment-failed',
                identity: 'form:team-failed::form-failed',
                registrationId: 'failed',
                retryable: true
            })
        ]);
        expect(page.retryCursor).toEqual({});
    });
});
