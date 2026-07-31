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

function buildListParentRegistrationApplicationsPage({
    registration,
    form = null,
    getTeam = vi.fn().mockResolvedValue({ id: 'team-1', name: 'Team One' }),
    getDocs = vi.fn().mockResolvedValue({
        docs: [{
            id: 'registration-1',
            ref: { path: 'teams/team-1/registrationForms/form-1/registrations/registration-1' },
            data: () => registration
        }]
    })
}) {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('export async function listParentRegistrationApplicationsPage');
    const end = dbSource.indexOf('\nexport async function getParentDashboardData', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'export async function listParentRegistrationApplicationsPage',
            'return async function listParentRegistrationApplicationsPage'
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
        limit: vi.fn(),
        PARENT_REGISTRATION_APPLICATION_PAGE_SIZE: 10,
        getDocs,
        mergeParentRegistrationQueryResults: buildMergeParentRegistrationQueryResults(),
        getParentRegistrationDocumentKey: (registrationDoc) => registrationDoc.ref?.path || registrationDoc.id,
        getTeam,
        getDoc,
        doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
        getRegistrationPlayerDraft: vi.fn().mockReturnValue({ name: 'Player One' }),
        getRegistrationGuardianDrafts: vi.fn().mockReturnValue([{ email: 'parent@example.com' }]),
        normalizeRegistrationStatus: (status = '') => status || 'pending',
        formatParentRegistrationStatusLabel: () => 'Pending Review'
    };
    const dependencyNames = Object.keys(dependencies);
    const listApplicationsPage = new Function(...dependencyNames, functionSource)(
        ...dependencyNames.map((name) => dependencies[name])
    );

    return { listApplicationsPage, getDoc, dependencies };
}

describe('parent dashboard registration application statuses', () => {
    it('renders a read-only parent registration applications section from dashboard data', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('id="registration-applications-list"');
        expect(html).toContain('listParentRegistrationApplicationsPage,');
        expect(html).toContain('loadRegistrationApplications(user);');
        expect(html).not.toContain('await loadRegistrationApplications(user);');
        expect(html).toContain('renderRegistrationApplications(page.applications, page.errors)');
        expect(html).toContain('Registration applications could not be loaded.');
        expect(html).toContain('registration-applications-list');
        expect(html).toContain('offer-extended');
        expect(html).toContain('Status is read-only and controlled by the team admin.');
        expect(html).toContain("from './js/db.js?v=131';");
    });

    it('loads registrations by verified guardian email or authoritative submitter uid without exposing write controls', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');
        const functionStart = db.indexOf('export async function listParentRegistrationApplicationsPage');
        const functionEnd = db.indexOf('\nexport async function getParentDashboardData', functionStart);
        const functionSource = db.slice(functionStart, functionEnd);
        const dashboardFunctionStart = db.indexOf('export async function getParentDashboardData');
        const dashboardFunctionEnd = db.indexOf('\nexport async function updatePlayerProfile', dashboardFunctionStart);
        const dashboardFunctionSource = db.slice(dashboardFunctionStart, dashboardFunctionEnd);

        expect(db).toContain("collectionGroup(db, 'registrations')");
        expect(functionSource).toContain("fieldPath: 'guardian.email'");
        expect(functionSource).toContain("fieldPath: 'submittedByUserId'");
        expect(functionSource).toContain('mergeParentRegistrationQueryResults(');
        expect(functionSource).not.toContain("orderBy('submittedAt'");
        expect(functionSource).not.toContain('startAfter(');
        expect(functionSource).not.toContain('limit(PARENT_REGISTRATION_APPLICATION_PAGE_SIZE)');
        expect(dashboardFunctionSource).not.toContain('listParentRegistrationApplicationsPage');
        expect(dashboardFunctionSource).not.toContain('registrationApplications');
        expect(rules).toContain('isCurrentUserRegistrationGuardian(resource.data)');
        const registrationRules = rules.match(/match \/registrations\/\{registrationId\} \{[\s\S]*?allow create:/)[0];
        expect(registrationRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
        expect(registrationRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId);');
        expect(registrationRules).not.toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
    });

    it('uses the registration snapshot program name without reading its registration form', async () => {
        const { listApplicationsPage, getDoc } = buildListParentRegistrationApplicationsPage({
            registration: {
                teamId: 'team-1',
                formId: 'form-1',
                programName: 'Spring Soccer',
                status: 'pending'
            }
        });

        const { applications } = await listApplicationsPage({ email: 'parent@example.com' });

        expect(applications[0].programName).toBe('Spring Soccer');
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('reads the registration form once to resolve a legacy registration program name', async () => {
        const { listApplicationsPage, getDoc } = buildListParentRegistrationApplicationsPage({
            registration: {
                teamId: 'team-1',
                formId: 'form-1',
                status: 'pending'
            },
            form: { programName: 'Legacy Soccer' }
        });

        const { applications } = await listApplicationsPage({ email: 'parent@example.com' });

        expect(applications[0].programName).toBe('Legacy Soccer');
        expect(getDoc).toHaveBeenCalledTimes(1);
    });

    it('fetches and enriches only the first bounded merged page', async () => {
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
        const { listApplicationsPage, dependencies } = buildListParentRegistrationApplicationsPage({
            registration: canonical.data(),
            getDocs
        });

        const { applications } = await listApplicationsPage({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications.map((application) => application.id)).toEqual(
            ['canonical', 'string-date', 'created-at-fallback', 'missing-date']
        );
        expect(getDocs).toHaveBeenCalledTimes(2);
        expect(dependencies.query).toHaveBeenCalledTimes(2);
        expect(dependencies.limit).not.toHaveBeenCalled();
        expect(dependencies.getTeam).toHaveBeenCalledTimes(1);
    });

    it('selects the newest 10 before enrichment from unordered identity results larger than the page', async () => {
        const olderGuardianDocs = Array.from({ length: 10 }, (_, index) => (
            buildRegistrationDocument(`older-${index}`, index + 1, {
                programName: 'Spring Soccer'
            })
        ));
        const newerGuardianDocs = Array.from({ length: 5 }, (_, index) => (
            buildRegistrationDocument(`newer-guardian-${index}`, 100 + index, {
                programName: 'Spring Soccer'
            })
        ));
        const newerSubmitterDocs = Array.from({ length: 5 }, (_, index) => (
            buildRegistrationDocument(`newer-submitter-${index}`, 105 + index, {
                programName: 'Spring Soccer'
            })
        ));
        const getDocs = vi.fn()
            .mockResolvedValueOnce({ docs: [...olderGuardianDocs, ...newerGuardianDocs] })
            .mockResolvedValueOnce({ docs: [...olderGuardianDocs, ...newerSubmitterDocs] });
        const { listApplicationsPage, dependencies } = buildListParentRegistrationApplicationsPage({
            registration: olderGuardianDocs[0].data(),
            getDocs
        });

        const page = await listApplicationsPage({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(page.applications.map((application) => application.id)).toEqual([
            'newer-submitter-4',
            'newer-submitter-3',
            'newer-submitter-2',
            'newer-submitter-1',
            'newer-submitter-0',
            'newer-guardian-4',
            'newer-guardian-3',
            'newer-guardian-2',
            'newer-guardian-1',
            'newer-guardian-0'
        ]);
        expect(page.nextCursor).toBeNull();
        expect(page.hasMore).toBe(true);
        expect(dependencies.getTeam).toHaveBeenCalledTimes(10);
        expect(dependencies.limit).not.toHaveBeenCalled();
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
        const { listApplicationsPage } = buildListParentRegistrationApplicationsPage({
            registration: registrationDoc.data(),
            getDocs
        });

        const { applications, errors } = await listApplicationsPage({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications.map((application) => application.id)).toEqual(['submitter-match']);
        expect(errors).toHaveLength(1);
    });

    it('reports a registration-specific error when all identity queries fail', async () => {
        const { listApplicationsPage } = buildListParentRegistrationApplicationsPage({
            registration: {},
            getDocs: vi.fn().mockRejectedValue(new Error('registration index unavailable'))
        });

        await expect(listApplicationsPage({
            id: 'parent-1',
            email: 'parent@example.com'
        })).rejects.toThrow('Registration applications could not be loaded.');
    });

    it('reports a registration-specific error when page enrichment fails', async () => {
        const registrationDoc = buildRegistrationDocument('registration-1', 100, {
            programName: 'Spring Soccer'
        });
        const { listApplicationsPage } = buildListParentRegistrationApplicationsPage({
            registration: registrationDoc.data(),
            getDocs: vi.fn().mockResolvedValue({ docs: [registrationDoc] }),
            getTeam: vi.fn().mockRejectedValue(new Error('team unavailable'))
        });

        await expect(listApplicationsPage({
            id: 'parent-1',
            email: 'parent@example.com'
        })).rejects.toThrow('Registration application details could not be loaded.');
    });
});
